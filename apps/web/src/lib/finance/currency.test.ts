import { describe, expect, it } from 'vitest';
import { resolveCurrency } from './currency';

describe('resolveCurrency', () => {
  it.each([
    ['рублей', 'RUB'], ['₽', 'RUB'], ['руб.', 'RUB'], ['RUB', 'RUB'],
    ['долларов', 'USD'], ['USD', 'USD'], ['U$S', 'USD'], ['баксов', 'USD'],
    ['аргентинских песо', 'ARS'], ['ARS', 'ARS'],
  ])('%s → %s', (raw, expected) => {
    expect(resolveCurrency(raw)).toEqual({ status: 'resolved', currency: expected });
  });
  it('treats a bare "$" as ambiguous between USD and ARS', () => {
    expect(resolveCurrency('$')).toMatchObject({ status: 'ambiguous', candidates: ['USD', 'ARS'] });
  });
  it('treats a bare "песо" as ambiguous unless the user is configured for ARS', () => {
    expect(resolveCurrency('песо').status).toBe('ambiguous');
    expect(resolveCurrency('песо', { pesoMeans: 'ARS' })).toEqual({ status: 'resolved', currency: 'ARS' });
  });
  it('does not accept other pesos or unsupported currencies', () => {
    expect(resolveCurrency('мексиканских песо').status).toBe('unsupported');
    expect(resolveCurrency('евро').status).toBe('unsupported');
  });
  it('reports missing currency', () => {
    expect(resolveCurrency(null).status).toBe('missing');
  });
});
