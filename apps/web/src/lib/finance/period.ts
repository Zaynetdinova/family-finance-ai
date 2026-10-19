import { type DateRange, type IsoDate, addDays, daysInRange, endOfMonth, isIsoDate, monthRange, startOfMonth, weekRange } from './dates';

export const PERIOD_KEYS = ['today', 'week', 'month', 'prev_month', '30d', 'year', 'custom'] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export interface ResolvedPeriod extends DateRange {
  key: PeriodKey;
}

const MAX_CUSTOM_DAYS = 3660;

/** Turn URL parameters into a concrete date range. Invalid input falls back to the current month. */
export function resolvePeriod(
  params: { period?: string | null; from?: string | null; to?: string | null },
  today: IsoDate,
): ResolvedPeriod {
  const key = (PERIOD_KEYS as readonly string[]).includes(params.period ?? '') ? (params.period as PeriodKey) : 'month';
  switch (key) {
    case 'today':
      return { key, from: today, to: today };
    case 'week':
      return { key, ...weekRange(today) };
    case 'prev_month': {
      const prev = addDays(startOfMonth(today), -1);
      return { key, ...monthRange(prev) };
    }
    case '30d':
      return { key, from: addDays(today, -29), to: today };
    case 'year':
      return { key, from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'custom': {
      const { from, to } = params;
      if (from && to && isIsoDate(from) && isIsoDate(to) && from <= to && daysInRange(from, to) <= MAX_CUSTOM_DAYS) {
        return { key, from, to };
      }
      return { key: 'month', from: startOfMonth(today), to: endOfMonth(today) };
    }
    case 'month':
    default:
      return { key: 'month', ...monthRange(today) };
  }
}

/** Today's calendar date in an IANA time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
