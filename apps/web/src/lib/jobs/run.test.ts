import { beforeEach, describe, expect, it } from 'vitest';
import { runTick, type JobDeps, type JobStore, type Recipient } from './run';
import type { AppContext } from '@/lib/db/queries';
import { rub } from '@/lib/finance/fixtures';

const ctx = (userId: string): AppContext => ({
  supabase: null as never, userId, email: null, role: 'owner', today: '2026-10-18',
  profile: { id: userId, display_name: null, base_currency: 'RUB', timezone: 'UTC', locale: 'ru', telegram_user_id: 1 },
  household: { id: 'h', name: 'H', base_currency: 'RUB' }, members: [], households: [], accounts: [], categories: [],
  debts: [{ id: 'd1', household_id: 'h', direction: 'owed_by_me', kind: 'loan', name: 'Кредит', counterparty: null, currency: 'RUB', original_amount: 1000, current_balance: 900, interest_rate: 10, rate_type: 'fixed', min_payment: 100, payment_day: 20, opened_on: null, due_date: null, allows_prepayment: true, priority: false, status: 'active', notes: null }],
});

class Store implements JobStore {
  claimed = new Map<string, 'claimed' | 'sent'>();
  list: Recipient[] = [];
  async recipients() { return this.list; }
  async loadContext(userId: string) { return ctx(userId); }
  async claim(userId: string, _k: string, key: string) { const id = `${userId}|${key}`; if (this.claimed.has(id)) return false; this.claimed.set(id, 'claimed'); return true; }
  async markSent(userId: string, key: string) { this.claimed.set(`${userId}|${key}`, 'sent'); }
  async release(userId: string, key: string) { this.claimed.delete(`${userId}|${key}`); }
}

let store: Store, sent: { chatId: number; html: string }[], deps: JobDeps, now: Date, failSend: boolean;

beforeEach(() => {
  store = new Store();
  sent = [];
  failSend = false;
  now = new Date('2026-10-18T20:30:00Z'); // Sunday 20:30 UTC
  store.list = [{ userId: 'u1', chatId: 11, timezone: 'UTC', schedules: [], prefs: null }];
  deps = {
    store,
    send: async (chatId, html) => { if (failSend) throw new Error('Telegram sendMessage: Forbidden'); sent.push({ chatId, html }); },
    render: {
      report: async (_c, kind, closed) => `report:${kind}:${closed}`,
      upcoming: async () => [{ debtId: 'd1', name: 'Кредит', currency: 'RUB', amount: rub('100'), date: '2026-10-20', overdue: false }],
      limits: async () => [{ id: 'l1', name: 'Продукты', usedBp: 9000, state: 'warning' }],
    },
    now: () => now,
  };
});

describe('runTick', () => {
  it('sends the weekly report, a payment reminder and a budget alert at the right local time', async () => {
    const r = await runTick(deps);
    expect(sent.map((s) => s.html)).toEqual([
      'report:weekly:false',
      expect.stringContaining('20 октября 2026 платёж «Кредит»'),
      expect.stringContaining('Лимит «Продукты» использован (90%)'),
    ]);
    expect(r.sent).toEqual({ weekly: 1, payment: 1, budget: 1 });
    expect(r.errors).toEqual([]);
  });

  it('is idempotent: a second run in the same hour sends nothing', async () => {
    await runTick(deps);
    const before = sent.length;
    await runTick(deps);
    expect(sent.length).toBe(before);
  });

  it('respects the user time zone (Tokyo is already Monday 05:30 → no weekly report, quiet hours)', async () => {
    store.list = [{ userId: 'u1', chatId: 11, timezone: 'Asia/Tokyo', schedules: [], prefs: null }];
    const r = await runTick(deps);
    expect(sent).toEqual([]);
    expect(r.skipped).toBe(1);
  });

  it('catches up a missed hour later the same day (Moscow: Sunday 23:30)', async () => {
    store.list = [{ userId: 'u1', chatId: 11, timezone: 'Europe/Moscow', schedules: [], prefs: null }];
    await runTick(deps);
    expect(sent.map((x) => x.html)).toEqual(['report:weekly:false']); // reminders are quiet after 22:00
  });

  it('sends the monthly report for the closed month on the 1st', async () => {
    now = new Date('2026-11-01T12:00:00Z');
    await runTick(deps);
    expect(sent[0]!.html).toBe('report:monthly:true');
  });

  it('a failed send releases the claim so the next run retries, and errors do not stop other users', async () => {
    store.list.push({ userId: 'u2', chatId: 22, timezone: 'UTC', schedules: [], prefs: { paymentReminders: false, reminderDaysBefore: 3, budgetAlerts: false, budgetAlertPct: 80 } });
    failSend = true;
    const r = await runTick(deps);
    expect(r.errors.length).toBeGreaterThan(0);
    expect([...store.claimed.values()].filter((v) => v === 'sent')).toEqual([]);
    expect(store.claimed.size).toBe(0);
    failSend = false;
    const r2 = await runTick(deps);
    expect(r2.sent.weekly).toBe(2); // both users got the weekly report on retry
    expect(sent.filter((s) => s.html === 'report:weekly:false').map((s) => s.chatId)).toEqual([11, 22]);
  });

  it('honours disabled preferences and schedules', async () => {
    store.list = [{
      userId: 'u1', chatId: 11, timezone: 'UTC', prefs: { paymentReminders: false, reminderDaysBefore: 3, budgetAlerts: false, budgetAlertPct: 80 },
      schedules: [{ household_id: 'h', kind: 'weekly', enabled: false, send_hour: 20, send_weekday: 7 }],
    }];
    await runTick(deps);
    expect(sent).toEqual([]);
  });
});
