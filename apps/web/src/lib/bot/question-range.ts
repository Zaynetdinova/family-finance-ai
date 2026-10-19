import { daysInRange, isIsoDate, startOfMonth, type DateRange } from '@/lib/finance/dates';

/** A period from model output, validated; future end dates are clipped to today; default = month to date. */
export function questionRange(from: string | null, to: string | null, today: string): DateRange {
  if (from && to && isIsoDate(from) && isIsoDate(to) && from <= to && from <= today && daysInRange(from, to) <= 3660) {
    return { from, to: to > today ? today : to };
  }
  return { from: startOfMonth(today), to: today };
}
