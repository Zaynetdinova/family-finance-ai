// Calendar-date helpers on 'YYYY-MM-DD' strings. All math is done in UTC so that
// results never depend on the server's time zone or DST.

export type IsoDate = string;

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: string): boolean {
  const m = RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return toIso(d) === s;
}

function toIso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

function parse(s: IsoDate): Date {
  if (!isIsoDate(s)) throw new Error(`Invalid ISO date: ${s}`);
  const m = RE.exec(s)!;
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
}

export function addDays(s: IsoDate, n: number): IsoDate {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

/** Number of days from a to b (b - a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

/** Inclusive day count of a range. */
export function daysInRange(from: IsoDate, to: IsoDate): number {
  return diffDays(from, to) + 1;
}

export function startOfMonth(s: IsoDate): IsoDate {
  return `${s.slice(0, 7)}-01`;
}

export function endOfMonth(s: IsoDate): IsoDate {
  const d = parse(startOfMonth(s));
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return toIso(d);
}

export function addMonths(s: IsoDate, n: number): IsoDate {
  const d = parse(startOfMonth(s));
  d.setUTCMonth(d.getUTCMonth() + n);
  return toIso(d);
}

/** Monday of the ISO week containing s. */
export function startOfWeek(s: IsoDate): IsoDate {
  const d = parse(s);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  return addDays(s, -dow);
}

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export function monthRange(s: IsoDate): DateRange {
  return { from: startOfMonth(s), to: endOfMonth(s) };
}

export function weekRange(s: IsoDate): DateRange {
  const from = startOfWeek(s);
  return { from, to: addDays(from, 6) };
}

/**
 * The range a period should be compared with.
 * - Whole calendar month → previous calendar month; any other range → the immediately
 *   preceding range of equal length.
 * - If the period is still in progress (asOf falls inside it, before its last day), only the
 *   same number of elapsed days of the previous period are used, so "8 days of October" is
 *   never compared with all of September.
 * `truncated` is true when the previous period is shorter than the elapsed span asked for.
 */
export function previousComparableRange(range: DateRange, asOf: IsoDate): DateRange & { truncated: boolean } {
  const isWholeMonth = range.from === startOfMonth(range.from) && range.to === endOfMonth(range.from);
  let prevStart: IsoDate;
  let prevEnd: IsoDate;
  if (isWholeMonth) {
    prevStart = addMonths(range.from, -1);
    prevEnd = endOfMonth(prevStart);
  } else {
    const len = daysInRange(range.from, range.to);
    prevStart = addDays(range.from, -len);
    prevEnd = addDays(range.from, -1);
  }
  if (asOf >= range.from && asOf < range.to) {
    const to = addDays(prevStart, daysInRange(range.from, asOf) - 1);
    return to > prevEnd ? { from: prevStart, to: prevEnd, truncated: true } : { from: prevStart, to, truncated: false };
  }
  return { from: prevStart, to: prevEnd, truncated: false };
}

/** Same day-of-month n months later; clamps to the last day of shorter months (Jan 31 + 1 → Feb 28/29). */
export function addMonthsKeepDay(s: IsoDate, n: number): IsoDate {
  const target = addMonths(s, n);
  const last = Number(endOfMonth(target).slice(8));
  return `${target.slice(0, 8)}${String(Math.min(Number(s.slice(8)), last)).padStart(2, '0')}`;
}

/** ISO-8601 week label, e.g. '2026-W42' (weeks start on Monday; week 1 contains the first Thursday). */
export function isoWeekKey(s: IsoDate): string {
  const d = parse(s);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}
