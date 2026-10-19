import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, DEFAULT_SCHEDULES, dueBudgetAlerts, duePaymentReminders, dueReports, localTime, mergeSchedules } from './schedule';
import { isoWeekKey } from '@/lib/finance/dates';
import { rub } from '@/lib/finance/fixtures';

describe('localTime', () => {
  it('converts to the user time zone, including date changes', () => {
    const now = new Date('2026-10-18T21:30:00Z'); // Sunday 21:30 UTC
    expect(localTime(now, 'UTC')).toEqual({ date: '2026-10-18', hour: 21, isoWeekday: 7 });
    expect(localTime(now, 'Europe/Moscow')).toEqual({ date: '2026-10-19', hour: 0, isoWeekday: 1 });
    expect(localTime(now, 'America/Argentina/Buenos_Aires')).toEqual({ date: '2026-10-18', hour: 18, isoWeekday: 7 });
    expect(localTime(now, 'Not/AZone').hour).toBe(21);
  });
});

describe('isoWeekKey', () => {
  it('follows ISO-8601 including year boundaries', () => {
    expect(isoWeekKey('2026-10-19')).toBe('2026-W43');
    expect(isoWeekKey('2026-10-18')).toBe('2026-W42');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53'); // Friday belongs to the last week of 2026
    expect(isoWeekKey('2024-12-30')).toBe('2025-W01');
  });
});

describe('dueReports', () => {
  const all = DEFAULT_SCHEDULES.map((s) => ({ ...s, enabled: true }));
  it('nothing before the send hour, daily from it, and it stays due for the rest of the day (catch-up)', () => {
    expect(dueReports(all, { date: '2026-10-14', hour: 20, isoWeekday: 3 })).toEqual([]);
    expect(dueReports(all, { date: '2026-10-14', hour: 21, isoWeekday: 3 })).toEqual([{ kind: 'daily', dedupeKey: 'daily:2026-10-14', closedMonth: false }]);
    expect(dueReports(all, { date: '2026-10-14', hour: 23, isoWeekday: 3 }).map((r) => r.dedupeKey)).toEqual(['daily:2026-10-14']);
  });
  it('weekly only on the chosen weekday', () => {
    expect(dueReports(all, { date: '2026-10-18', hour: 20, isoWeekday: 7 }).map((r) => r.dedupeKey)).toEqual(['weekly:2026-W42']);
    expect(dueReports(all, { date: '2026-10-17', hour: 20, isoWeekday: 6 })).toEqual([]);
  });
  it('monthly on the 1st for the previous, closed month', () => {
    expect(dueReports(all, { date: '2026-11-01', hour: 10, isoWeekday: 7 })).toContainEqual({ kind: 'monthly', dedupeKey: 'monthly:2026-10', closedMonth: true });
    expect(dueReports(all, { date: '2027-01-01', hour: 10, isoWeekday: 5 })).toContainEqual({ kind: 'monthly', dedupeKey: 'monthly:2026-12', closedMonth: true });
  });
  it('disabled reports are never due; saved settings override defaults', () => {
    expect(dueReports(DEFAULT_SCHEDULES, { date: '2026-10-14', hour: 23, isoWeekday: 3 })).toEqual([]); // daily is off by default
    const merged = mergeSchedules([{ kind: 'weekly', enabled: true, send_hour: 9, send_weekday: 1 }, { kind: 'monthly', enabled: false, send_hour: 10, send_weekday: null }]);
    expect(merged.find((s) => s.kind === 'weekly')).toEqual({ kind: 'weekly', enabled: true, sendHour: 9, sendWeekday: 1 });
    expect(dueReports(merged, { date: '2026-11-01', hour: 12, isoWeekday: 7 })).toEqual([]);
  });
});

describe('reminders', () => {
  const pay = (date: string, overdue = false) => ({ debtId: 'd1', name: 'Ипотека', currency: 'RUB' as const, amount: rub('40000'), date, overdue });
  const t = { date: '2026-10-22', hour: 10, isoWeekday: 4 };
  it('payment reminders inside the window, including overdue; one key per payment date', () => {
    const r = duePaymentReminders([pay('2026-10-20', true), pay('2026-10-25'), pay('2026-11-25')], DEFAULT_PREFS, t);
    expect(r.map((x) => x.dedupeKey)).toEqual(['payment:d1:2026-10-20', 'payment:d1:2026-10-25']);
  });
  it('quiet hours and disabled reminders send nothing', () => {
    expect(duePaymentReminders([pay('2026-10-25')], DEFAULT_PREFS, { ...t, hour: 7 })).toEqual([]);
    expect(duePaymentReminders([pay('2026-10-25')], DEFAULT_PREFS, { ...t, hour: 23 })).toEqual([]);
    expect(duePaymentReminders([pay('2026-10-25')], { ...DEFAULT_PREFS, paymentReminders: false }, t)).toEqual([]);
  });
  it('budget alerts at the threshold and when exceeded, once per month and level', () => {
    const r = dueBudgetAlerts([
      { id: 'l1', name: 'Продукты', usedBp: 8500, state: 'warning' },
      { id: 'l2', name: 'Кафе', usedBp: 12000, state: 'exceeded' },
      { id: 'l3', name: 'Такси', usedBp: 5000, state: 'ok' },
    ], DEFAULT_PREFS, t);
    expect(r.map((x) => x.dedupeKey)).toEqual(['budget:l1:2026-10:threshold', 'budget:l2:2026-10:exceeded']);
    expect(dueBudgetAlerts([{ id: 'l1', name: 'x', usedBp: 8500, state: 'warning' }], { ...DEFAULT_PREFS, budgetAlertPct: 90 }, t)).toEqual([]);
  });
});
