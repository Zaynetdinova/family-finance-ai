import type { AppContext } from '@/lib/db/queries';
import type { UpcomingPayment } from '@/lib/finance/debts';
import { formatMinor } from '@/lib/finance/money';
import { dateRu, esc } from '@/lib/telegram/format';
import {
  DEFAULT_PREFS, dueBudgetAlerts, duePaymentReminders, dueReports, localTime, mergeSchedules, QUIET_FROM_HOUR, QUIET_UNTIL_HOUR,
  type LimitInfo, type ReminderPrefs, type ReportKind,
} from './schedule';

export interface Recipient {
  userId: string;
  chatId: number;
  timezone: string;
  schedules: { household_id: string; kind: string; enabled: boolean; send_hour: number; send_weekday: number | null }[];
  prefs: ReminderPrefs | null;
}

export interface JobStore {
  recipients(): Promise<Recipient[]>;
  loadContext(userId: string, householdId: string | null): Promise<AppContext | null>;
  /** Inserts the dedupe row; false when this notification was already claimed or sent. */
  claim(userId: string, kind: string, key: string): Promise<boolean>;
  markSent(userId: string, key: string): Promise<void>;
  release(userId: string, key: string): Promise<void>;
}

export interface JobRender {
  report(ctx: AppContext, kind: ReportKind, closedMonth: boolean): Promise<string>;
  upcoming(ctx: AppContext): Promise<UpcomingPayment[]>;
  limits(ctx: AppContext): Promise<LimitInfo[]>;
}

export interface JobDeps {
  store: JobStore;
  send: (chatId: number, html: string) => Promise<void>;
  render: JobRender;
  now: () => Date;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface TickResult {
  recipients: number;
  sent: Record<string, number>;
  skipped: number;
  errors: { userId: string; key: string; error: string }[];
}

const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** One scheduler run: everything due for every linked user, each message at most once. */
export async function runTick(deps: JobDeps): Promise<TickResult> {
  const result: TickResult = { recipients: 0, sent: {}, skipped: 0, errors: [] };
  const recipients = await deps.store.recipients();
  result.recipients = recipients.length;

  for (const r of recipients) {
    const t = localTime(deps.now(), r.timezone);
    const prefs = r.prefs ?? DEFAULT_PREFS;
    const householdId = r.schedules[0]?.household_id ?? null;
    const reports = dueReports(mergeSchedules(r.schedules.filter((s) => s.household_id === householdId || !householdId)), t);
    const remindersPossible = t.hour >= QUIET_UNTIL_HOUR && t.hour < QUIET_FROM_HOUR && (prefs.paymentReminders || prefs.budgetAlerts);
    if (!reports.length && !remindersPossible) {
      result.skipped++;
      continue;
    }

    let ctx: AppContext | null;
    try {
      ctx = await deps.store.loadContext(r.userId, householdId);
    } catch (e) {
      result.errors.push({ userId: r.userId, key: 'context', error: short(e) });
      continue;
    }
    if (!ctx) {
      result.skipped++;
      continue;
    }
    const c = ctx;

    const deliver = async (kind: string, key: string, build: () => Promise<string>) => {
      if (!(await deps.store.claim(r.userId, kind, key))) return;
      try {
        await deps.send(r.chatId, await build());
        await deps.store.markSent(r.userId, key);
        result.sent[kind] = (result.sent[kind] ?? 0) + 1;
      } catch (e) {
        // Release so the next run retries; nothing was (fully) delivered.
        await deps.store.release(r.userId, key).catch(() => undefined);
        result.errors.push({ userId: r.userId, key, error: short(e) });
        deps.log?.('notification failed', { userId: r.userId, key, error: short(e) });
      }
    };

    for (const rep of reports) await deliver(rep.kind, rep.dedupeKey, () => deps.render.report(c, rep.kind, rep.closedMonth));

    if (remindersPossible && prefs.paymentReminders && c.debts.some((d) => d.status === 'active' && d.direction === 'owed_by_me')) {
      try {
        for (const { payment: p, dedupeKey } of duePaymentReminders(await deps.render.upcoming(c), prefs, t)) {
          await deliver('payment', dedupeKey, async () =>
            p.overdue
              ? `⚠️ Платёж «${esc(p.name)}» на ${esc(formatMinor(p.amount, p.currency))} был запланирован на ${dateRu(p.date)} и не записан. Если он уже внесён — запишите его, чтобы обновить остаток долга.`
              : `🔔 Напоминание: ${dateRu(p.date)} платёж «${esc(p.name)}» — ${esc(formatMinor(p.amount, p.currency))}.`);
        }
      } catch (e) {
        result.errors.push({ userId: r.userId, key: 'payments', error: short(e) });
      }
    }

    if (remindersPossible && prefs.budgetAlerts) {
      try {
        for (const { limit, level, dedupeKey } of dueBudgetAlerts(await deps.render.limits(c), prefs, t)) {
          const pct = limit.usedBp === null ? '' : ` (${(limit.usedBp / 100).toFixed(0)}%)`;
          await deliver('budget', dedupeKey, async () =>
            level === 'exceeded'
              ? `🔴 Лимит «${esc(limit.name)}» на этот месяц превышен${pct}.`
              : `🟡 Лимит «${esc(limit.name)}» использован${pct}. До конца месяца стоит притормозить траты в этой категории.`);
        }
      } catch (e) {
        result.errors.push({ userId: r.userId, key: 'budget', error: short(e) });
      }
    }
  }
  return result;
}

