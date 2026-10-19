import { type Currency, type Minor, formatMinor } from '@/lib/finance/money';

export const money = (minor: Minor, currency: Currency) => formatMinor(minor, currency);

/** Basis points → "12,3 %"; with sign → "+12,3 %". null → "—". */
export function pct(bp: number | null, opts: { signed?: boolean } = {}): string {
  if (bp === null) return '—';
  const v = (bp / 100).toFixed(1).replace('.', ',');
  const sign = opts.signed && bp > 0 ? '+' : bp < 0 ? '−' : '';
  return `${sign}${v.replace('-', '')}\u00a0%`;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/** '2026-10-05' → '5 окт'; with year when it differs from `now`'s year. */
export function dateShort(iso: string, nowYear?: string): string {
  const d = Number(iso.slice(8));
  const m = MONTHS[Number(iso.slice(5, 7)) - 1] ?? '';
  const y = iso.slice(0, 4);
  return nowYear && y !== nowYear ? `${d} ${m} ${y}` : `${d} ${m}`;
}

export const monthName = (iso: string) => `${MONTHS_FULL[Number(iso.slice(5, 7)) - 1] ?? ''} ${iso.slice(0, 4)}`;

export function rangeLabel(from: string, to: string): string {
  return from === to ? dateShort(from, '') : `${dateShort(from, '')} — ${dateShort(to, '')}`;
}

/** Minor units → float in major units. ONLY for drawing charts; never for calculations. */
export const toChartNumber = (minor: Minor): number => Number(minor) / 100;
