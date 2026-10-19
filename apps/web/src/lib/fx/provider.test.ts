import { describe, expect, it } from 'vitest';
import { fetchProviderRates, parseProviderResponse } from './provider';

const sample = { result: 'success', time_last_update_unix: 1_791_000_000, base_code: 'USD', rates: { USD: 1, RUB: 91.2345, ARS: 1050.5, EUR: 0.9 } };

describe('exchange-rate provider', () => {
  it('extracts USD→RUB and USD→ARS with the provider date', () => {
    const r = parseProviderResponse(sample);
    expect(r.ok && r.rows).toEqual([
      { base_currency: 'USD', quote_currency: 'RUB', rate: '91.2345000000', rate_date: '2026-10-03', source: 'open.er-api.com' },
      { base_currency: 'USD', quote_currency: 'ARS', rate: '1050.5000000000', rate_date: '2026-10-03', source: 'open.er-api.com' },
    ]);
  });
  it('rejects error payloads, missing currencies and non-positive rates', () => {
    expect(parseProviderResponse({ result: 'error' }).ok).toBe(false);
    expect(parseProviderResponse({ ...sample, rates: { RUB: 90 } }).ok).toBe(false);
    expect(parseProviderResponse({ ...sample, rates: { RUB: 0, ARS: 1 } }).ok).toBe(false);
    expect(parseProviderResponse(null).ok).toBe(false);
  });
  it('reports network and HTTP failures without throwing', async () => {
    expect(await fetchProviderRates((async () => { throw new Error('boom'); }) as typeof fetch)).toEqual({ ok: false, error: 'Exchange-rate provider is unreachable' });
    expect(await fetchProviderRates((async () => new Response('', { status: 503 })) as typeof fetch)).toEqual({ ok: false, error: 'Exchange-rate provider returned HTTP 503' });
    expect((await fetchProviderRates((async () => Response.json(sample)) as typeof fetch)).ok).toBe(true);
  });
});
