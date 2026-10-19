// Money arithmetic on integers. Amounts are bigint "minor units" (cents/kopecks/centavos);
// RUB, USD and ARS all use exactly 2 decimal places. FX rates are bigint scaled by RATE_SCALE.
// Floating point is never used for money.

export const CURRENCIES = ['RUB', 'USD', 'ARS'] as const;
export type Currency = (typeof CURRENCIES)[number];

export function isCurrency(s: unknown): s is Currency {
  return typeof s === 'string' && (CURRENCIES as readonly string[]).includes(s);
}

export type Minor = bigint;

export const RATE_DECIMALS = 10;
export const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);

/** Parse a decimal string ("1234.5", "1 234,50") into minor units. Rejects >2 decimals. */
export function parseAmount(input: string): Minor {
  const s = input.trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Invalid amount: "${input}"`);
  const minor = BigInt(m[2]!) * 100n + BigInt((m[3] ?? '').padEnd(2, '0') || '0');
  return m[1] ? -minor : minor;
}

/** Minor units → canonical decimal string for the database ("1234.50"). */
export function amountToString(minor: Minor): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const s = `${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** Parse an FX rate string with up to 10 decimals into a scaled bigint. */
export function parseRate(input: string): bigint {
  const s = input.trim().replace(',', '.');
  const m = /^(\d+)(?:\.(\d{1,10}))?$/.exec(s);
  if (!m) throw new Error(`Invalid rate: "${input}"`);
  const r = BigInt(m[1]!) * RATE_SCALE + BigInt((m[2] ?? '').padEnd(RATE_DECIMALS, '0') || '0');
  if (r <= 0n) throw new Error(`Rate must be positive: "${input}"`);
  return r;
}

export function rateToString(rate: bigint): string {
  return `${rate / RATE_SCALE}.${(rate % RATE_SCALE).toString().padStart(RATE_DECIMALS, '0')}`;
}

/** Integer division rounding half away from zero. */
export function divRound(num: bigint, den: bigint): bigint {
  if (den === 0n) throw new Error('Division by zero');
  const neg = (num < 0n) !== (den < 0n);
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const q = (2n * n + d) / (2n * d);
  return neg ? -q : q;
}

/** Convert minor units with a scaled rate (1 unit of source = rate units of target). */
export function convertMinor(minor: Minor, rate: bigint): Minor {
  return divRound(minor * rate, RATE_SCALE);
}

/** Basis points (1/100 of a percent) of part/whole, rounded; null if whole is zero. */
export function ratioBp(part: Minor, whole: Minor): number | null {
  if (whole === 0n) return null;
  return Number(divRound(part * 10_000n, whole));
}

/** Percent with 2 decimals from basis points, e.g. 1234 → 12.34. */
export function bpToPercent(bp: number | null): number | null {
  return bp === null ? null : bp / 100;
}

const SYMBOL: Record<Currency, string> = { RUB: '₽', USD: 'US$', ARS: 'AR$' };

/** Human-readable amount for UI/bot messages; always names the currency unambiguously. */
export function formatMinor(minor: Minor, currency: Currency, locale = 'ru-RU'): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const whole = new Intl.NumberFormat(locale).format(abs / 100n);
  const frac = (abs % 100n).toString().padStart(2, '0');
  const dec = new Intl.NumberFormat(locale).format(1.1).charAt(1);
  const body = frac === '00' ? whole : `${whole}${dec}${frac}`;
  return `${neg ? '−' : ''}${body}\u00a0${SYMBOL[currency]}`;
}

export function sumMinor(values: Iterable<Minor>): Minor {
  let t = 0n;
  for (const v of values) t += v;
  return t;
}
