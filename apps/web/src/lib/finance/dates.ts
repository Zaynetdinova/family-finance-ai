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
 * - Whole calendar month → previous calendar month (full).
 * - Month in progress (asOf inside it) → the same number of elapsed days of the previous
 *   month, so that "8 days of October" is never compared with all of September.
 * - Any other range → the immediately preceding range of equal length.
 * `truncated` is true when the previous month is shorter than the span asked for.
 */
export function previousComparableRange(range: DateRange, asOf: IsoDate): DateRange & { truncated: boolean } {
  const isWholeMonth = range.from === startOfMonth(range.from) && range.to === endOfMonth(range.from);
  if (isWholeMonth) {
    const prevStart = addMonths(range.from, -1);
    const prevEnd = endOfMonth(prevStart);
    const elapsed = asOf >= range.from && asOf < range.to ? daysInRange(range.from, asOf) : null;
    if (elapsed !== null) {
      const to = addDays(prevStart, elapsed - 1);
      return to > prevEnd ? { from: prevStart, to: prevEnd, truncated: true } : { from: prevStart, to, truncated: false };
    }
    return { from: prevStart, to: prevEnd, truncated: false };
  }
  const len = daysInRange(range.from, range.to);
  return { from: addDays(range.from, -len), to: addDays(range.from, -1), truncated: false };
}
