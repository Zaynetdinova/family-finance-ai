import { addDays, addMonths, isoWeekKey, type IsoDate } from '@/lib/finance/dates';
import type { UpcomingPayment } from '@/lib/finance/debts';
import type { LimitState } from '@/lib/finance/budget';

export type ReportKind = 'daily' | 'weekly' | 'monthly';

export interface LocalTime {
  date: IsoDate;
  hour: number;
  /** 1 = Monday … 7 = Sunday */
  isoWeekday: number;
}

/** Wall-clock date, hour and weekday in an IANA time zone (falls back to UTC for unknown zones). */
export function localTime(now: Date, timeZone: string): LocalTime {
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = 'UTC';
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday!) + 1;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, isoWeekday: wd };
}

export interface ReportSchedule {
  kind: ReportKind;
  enabled: boolean;
  sendHour: number;
  /** Weekly only: 1 = Monday … 7 = Sunday. */
  sendWeekday: number | null;
}

/** Used when the user has not saved their own settings. */
export const DEFAULT_SCHEDULES: ReportSchedule[] = [
  { kind: 'daily', enabled: false, sendHour: 21, sendWeekday: null },
  { kind: 'weekly', enabled: true, sendHour: 20, sendWeekday: 7 },
  { kind: 'monthly', enabled: true, sendHour: 10, sendWeekday: null },
];

export function mergeSchedules(rows: { kind: string; enabled: boolean; send_hour: number; send_weekday: number | null }[]): ReportSchedule[] {
  return DEFAULT_SCHEDULES.map((d) => {
    const r = rows.find((x) => x.kind === d.kind);
    return r ? { kind: d.kind, enabled: r.enabled, sendHour: r.send_hour, sendWeekday: d.kind === 'weekly' ? (r.send_weekday ?? 7) : null } : d;
  });
}

export interface DueReport {
  kind: ReportKind;
  dedupeKey: string;
  /** Monthly report on the 1st describes the previous, complete month. */
  closedMonth: boolean;
}

/**
 * Reports due at this local time. A report becomes due at its hour and stays due for the rest
 * of that day, so a missed hourly run is caught up later; the dedupe key makes it send once.
 *  - daily: every day, covers the current day;
 *  - weekly: on the chosen weekday, covers the current ISO week;
 *  - monthly: on the 1st, covers the previous complete month.
 */
export function dueReports(schedules: ReportSchedule[], t: LocalTime): DueReport[] {
  const out: DueReport[] = [];
  for (const s of schedules) {
    if (!s.enabled || t.hour < s.sendHour) continue;
    if (s.kind === 'daily') out.push({ kind: 'daily', dedupeKey: `daily:${t.date}`, closedMonth: false });
    if (s.kind === 'weekly' && t.isoWeekday === (s.sendWeekday ?? 7)) out.push({ kind: 'weekly', dedupeKey: `weekly:${isoWeekKey(t.date)}`, closedMonth: false });
    if (s.kind === 'monthly' && t.date.endsWith('-01')) out.push({ kind: 'monthly', dedupeKey: `monthly:${addMonths(t.date, -1).slice(0, 7)}`, closedMonth: true });
  }
  return out;
}

export interface ReminderPrefs {
  paymentReminders: boolean;
  reminderDaysBefore: number;
  budgetAlerts: boolean;
  budgetAlertPct: number;
}

export const DEFAULT_PREFS: ReminderPrefs = { paymentReminders: true, reminderDaysBefore: 3, budgetAlerts: true, budgetAlertPct: 80 };

/** Reminders are not sent at night. */
export const QUIET_UNTIL_HOUR = 9;
export const QUIET_FROM_HOUR = 22;
const quiet = (t: LocalTime) => t.hour < QUIET_UNTIL_HOUR || t.hour >= QUIET_FROM_HOUR;

/** Payments due within the reminder window (and overdue ones), one reminder per payment date. */
export function duePaymentReminders(upcoming: UpcomingPayment[], prefs: ReminderPrefs, t: LocalTime): { payment: UpcomingPayment; dedupeKey: string }[] {
  if (!prefs.paymentReminders || quiet(t)) return [];
  const until = addDays(t.date, prefs.reminderDaysBefore);
  return upcoming
    .filter((p) => p.date <= until)
    .map((p) => ({ payment: p, dedupeKey: `payment:${p.debtId}:${p.date}` }));
}

export interface LimitInfo {
  id: string;
  name: string;
  usedBp: number | null;
  state: LimitState;
}

/**
 * Budget alerts at two levels per limit and month: crossing the user's threshold and going over
 * 100%. Each level is reported once.
 */
export function dueBudgetAlerts(limits: LimitInfo[], prefs: ReminderPrefs, t: LocalTime): { limit: LimitInfo; level: 'threshold' | 'exceeded'; dedupeKey: string }[] {
  if (!prefs.budgetAlerts || quiet(t)) return [];
  const month = t.date.slice(0, 7);
  const out: { limit: LimitInfo; level: 'threshold' | 'exceeded'; dedupeKey: string }[] = [];
  for (const l of limits) {
    if (l.usedBp === null) continue;
    if (l.state === 'exceeded') out.push({ limit: l, level: 'exceeded', dedupeKey: `budget:${l.id}:${month}:exceeded` });
    else if (l.usedBp >= prefs.budgetAlertPct * 100) out.push({ limit: l, level: 'threshold', dedupeKey: `budget:${l.id}:${month}:threshold` });
  }
  return out;
}
