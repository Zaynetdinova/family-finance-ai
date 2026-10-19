import { type Currency, type Minor, RATE_SCALE, convertMinor, divRound } from './money';
import { type IsoDate, diffDays } from './dates';

/** 1 unit of `base` = `rate` units of `quote` (rate scaled by RATE_SCALE). */
export interface RateRow {
  base: Currency;
  quote: Currency;
  rate: bigint;
  date: IsoDate;
  source: string;
}

export interface PickedRate {
  rate: bigint;
  /** Date of the (oldest) rate used; stored with the transaction. */
  rateDate: IsoDate;
  source: string;
  path: 'identity' | 'direct' | 'inverse' | 'cross';
}

export const DEFAULT_MAX_RATE_AGE_DAYS = 7;
const PIVOT: Currency = 'USD';

function latest(rows: RateRow[], base: Currency, quote: Currency, on: IsoDate, maxAge: number): RateRow | null {
  let best: RateRow | null = null;
  for (const r of rows) {
    if (r.base !== base || r.quote !== quote) continue;
    if (r.date > on) continue; // never use a rate from the future
    if (diffDays(r.date, on) > maxAge) continue;
    if (!best || r.date > best.date) best = r;
  }
  return best;
}

function invert(rate: bigint): bigint {
  return divRound(RATE_SCALE * RATE_SCALE, rate);
}

/**
 * Find the exchange rate for converting `from` → `to` on a date:
 * identity, direct quote, inverse quote, or cross through USD. Returns null when no rate
 * that is recent enough exists — callers must not invent one.
 */
export function pickRate(
  rows: RateRow[],
  from: Currency,
  to: Currency,
  on: IsoDate,
  maxAgeDays = DEFAULT_MAX_RATE_AGE_DAYS,
): PickedRate | null {
  if (from === to) return { rate: RATE_SCALE, rateDate: on, source: 'identity', path: 'identity' };

  const direct = latest(rows, from, to, on, maxAgeDays);
  if (direct) return { rate: direct.rate, rateDate: direct.date, source: direct.source, path: 'direct' };

  const inv = latest(rows, to, from, on, maxAgeDays);
  if (inv) return { rate: invert(inv.rate), rateDate: inv.date, source: inv.source, path: 'inverse' };

  if (from !== PIVOT && to !== PIVOT) {
    const a = pickRate(rows, from, PIVOT, on, maxAgeDays);
    const b = pickRate(rows, PIVOT, to, on, maxAgeDays);
    if (a && b && a.path !== 'identity' && b.path !== 'identity') {
      return {
        rate: divRound(a.rate * b.rate, RATE_SCALE),
        rateDate: a.rateDate < b.rateDate ? a.rateDate : b.rateDate,
        source: a.source === b.source ? a.source : `${a.source}+${b.source}`,
        path: 'cross',
      };
    }
  }
  return null;
}

/** Snapshot stored on a transaction when it is saved. Later rate changes never touch it. */
export interface FxSnapshot {
  baseCurrency: Currency;
  rate: bigint;
  rateDate: IsoDate;
  source: string;
  baseAmount: Minor;
}

export function snapshotFx(
  amount: Minor,
  currency: Currency,
  baseCurrency: Currency,
  rows: RateRow[],
  on: IsoDate,
  maxAgeDays = DEFAULT_MAX_RATE_AGE_DAYS,
): FxSnapshot | null {
  const picked = pickRate(rows, currency, baseCurrency, on, maxAgeDays);
  if (!picked) return null;
  return {
    baseCurrency,
    rate: picked.rate,
    rateDate: picked.rateDate,
    source: picked.source,
    baseAmount: convertMinor(amount, picked.rate),
  };
}

export interface CurrencyAmount {
  currency: Currency;
  amount: Minor;
}

/**
 * Sum amounts of different currencies in `target` using the rates on `on`.
 * Amounts without a usable rate are returned separately instead of being guessed.
 */
export function sumInCurrency(
  items: CurrencyAmount[],
  target: Currency,
  rows: RateRow[],
  on: IsoDate,
  maxAgeDays = DEFAULT_MAX_RATE_AGE_DAYS,
): { total: Minor; unconverted: CurrencyAmount[] } {
  let total = 0n;
  const unconverted: CurrencyAmount[] = [];
  for (const it of items) {
    const picked = pickRate(rows, it.currency, target, on, maxAgeDays);
    if (!picked) unconverted.push(it);
    else total += convertMinor(it.amount, picked.rate);
  }
  return { total, unconverted };
}
