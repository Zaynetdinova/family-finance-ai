import { type Currency } from './money';

export type CurrencyResolution =
  | { status: 'resolved'; currency: Currency }
  | { status: 'ambiguous'; candidates: Currency[]; reason: 'dollar_sign' | 'peso' }
  | { status: 'unsupported'; raw: string }
  | { status: 'missing' };

export interface CurrencyContext {
  /**
   * What a bare "песо"/"peso" means for this user. Set to 'ARS' only when the user has
   * configured ARS (e.g. has an ARS account). Without it a bare "песо" stays ambiguous,
   * because Mexican, Chilean, Colombian... pesos exist.
   */
  pesoMeans?: Currency;
  /** What a bare "$" means. Never inferred automatically; only from an explicit user setting. */
  dollarSignMeans?: Currency;
}

const UNSUPPORTED = /(евро|€|eur\b|фунт|£|gbp|юан|cny|иен|jpy|тенге|kzt|гривн|uah|мексиканск|чилийск|колумбийск|уругвайск|кубинск|mxn|clp|cop|uyu)/i;

/**
 * Resolve currency text exactly as the user wrote it. The AI returns raw text and this
 * deterministic function decides — the model never picks a currency code on its own.
 */
export function resolveCurrency(raw: string | null | undefined, ctx: CurrencyContext = {}): CurrencyResolution {
  const text = (raw ?? '').trim().toLowerCase();
  if (!text) return { status: 'missing' };

  if (UNSUPPORTED.test(text)) return { status: 'unsupported', raw: raw!.trim() };

  // Explicit ARS markers win over generic "$" and "песо"
  if (/(^|\b)(ars|ar\$)(\b|$)|аргентин|argentin/.test(text.replace(/\s+/g, ' '))) {
    return { status: 'resolved', currency: 'ARS' };
  }
  // Explicit USD markers, including Argentine notation "u$s"
  if (/(^|\b)(usd|us\$|u\$s|u\$d)(\b|$)|доллар|долл\b|баксов|бакс|dollar/.test(text)) {
    return { status: 'resolved', currency: 'USD' };
  }
  if (/(^|\b)rub\b|₽|руб|(^|\s)р\.?$/.test(text)) return { status: 'resolved', currency: 'RUB' };

  if (/песо|peso/.test(text)) {
    return ctx.pesoMeans
      ? { status: 'resolved', currency: ctx.pesoMeans }
      : { status: 'ambiguous', candidates: ['ARS'], reason: 'peso' };
  }
  if (text === '$') {
    return ctx.dollarSignMeans
      ? { status: 'resolved', currency: ctx.dollarSignMeans }
      : { status: 'ambiguous', candidates: ['USD', 'ARS'], reason: 'dollar_sign' };
  }
  return { status: 'unsupported', raw: raw!.trim() };
}
