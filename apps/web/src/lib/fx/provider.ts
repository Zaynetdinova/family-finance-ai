import { z } from 'zod';

/**
 * Daily rates from ExchangeRate-API's open endpoint (https://open.er-api.com, attribution
 * required, updated about once a day). For ARS this is the OFFICIAL rate; Argentina also has
 * market ("blue") rates that differ materially, so users can enter their own via the manual
 * rate form (source = 'manual', which wins over imported rates for the same date).
 */
export const FX_SOURCE = 'open.er-api.com';
export const FX_URL = 'https://open.er-api.com/v6/latest/USD';

const responseSchema = z.object({
  result: z.literal('success'),
  time_last_update_unix: z.number().int().positive(),
  rates: z.record(z.string(), z.number().positive()),
});

export interface FxRow {
  base_currency: 'USD';
  quote_currency: 'RUB' | 'ARS';
  rate: string;
  rate_date: string;
  source: string;
}

/** Validate the provider response and extract USD→RUB and USD→ARS. Cross rates are derived on read. */
export function parseProviderResponse(json: unknown): { ok: true; rows: FxRow[] } | { ok: false; error: string } {
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: 'Unexpected response from the exchange-rate provider' };
  const date = new Date(parsed.data.time_last_update_unix * 1000).toISOString().slice(0, 10);
  const rows: FxRow[] = [];
  for (const quote of ['RUB', 'ARS'] as const) {
    const v = parsed.data.rates[quote];
    if (v === undefined) return { ok: false, error: `Provider response has no ${quote} rate` };
    rows.push({ base_currency: 'USD', quote_currency: quote, rate: v.toFixed(10), rate_date: date, source: FX_SOURCE });
  }
  return { ok: true, rows };
}

export async function fetchProviderRates(fetchImpl: typeof fetch = fetch) {
  let res: Response;
  try {
    res = await fetchImpl(FX_URL, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
  } catch {
    return { ok: false as const, error: 'Exchange-rate provider is unreachable' };
  }
  if (!res.ok) return { ok: false as const, error: `Exchange-rate provider returned HTTP ${res.status}` };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false as const, error: 'Exchange-rate provider returned invalid JSON' };
  }
  return parseProviderResponse(json);
}
