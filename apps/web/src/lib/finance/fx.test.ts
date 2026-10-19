import { describe, expect, it } from 'vitest';
import { pickRate, snapshotFx } from './fx';
import { parseRate, rateToString } from './money';
import { summarize } from './summary';
import { rates, rub, tx } from './fixtures';

describe('fx', () => {
  it('11. snapshot stores rate, date and base amount; later rates do not rewrite it', () => {
    const snap = snapshotFx(rub('35'), 'USD', 'RUB', rates, '2026-10-16')!;
    expect(snap).toMatchObject({ baseAmount: rub('3150'), rateDate: '2026-10-15' });
    const stored = tx({ type: 'expense', currency: 'USD', accountId: 'acc-usd', amount: rub('35'), occurredOn: '2026-10-16',
      fx: { baseCurrency: 'RUB', rate: snap.rate, rateDate: snap.rateDate, baseAmount: snap.baseAmount } });
    const range = { from: '2026-10-01', to: '2026-10-31' };
    const before = summarize([stored], { range, view: { mode: 'base', currency: 'RUB' }, asOf: '2026-10-20' });
    // the market moves; the stored transaction is untouched
    snapshotFx(rub('35'), 'USD', 'RUB', [...rates, { base: 'USD', quote: 'RUB', rate: parseRate('120'), date: '2026-10-17', source: 'x' }], '2026-10-17');
    const after = summarize([stored], { range, view: { mode: 'base', currency: 'RUB' }, asOf: '2026-10-20' });
    expect(after.expense).toBe(before.expense);
    expect(after.expense).toBe(rub('3150'));
  });

  it('uses inverse and cross rates', () => {
    expect(pickRate(rates, 'RUB', 'USD', '2026-10-16')).toMatchObject({ path: 'inverse' });
    const cross = pickRate(rates, 'ARS', 'RUB', '2026-10-16')!;
    expect(cross.path).toBe('cross');
    expect(rateToString(cross.rate)).toBe('0.0900000000'); // 90 / 1000
  });

  it('never uses a future rate and refuses stale ones', () => {
    expect(pickRate(rates, 'USD', 'RUB', '2026-10-14')).toBeNull();
    expect(pickRate(rates, 'USD', 'RUB', '2026-11-30')).toBeNull();
    expect(pickRate(rates, 'USD', 'RUB', '2026-11-30', 60)).not.toBeNull();
  });

  it('prefers the most recent rate on or before the date', () => {
    const more = [...rates, { base: 'USD' as const, quote: 'RUB' as const, rate: parseRate('95'), date: '2026-10-17', source: 't' }];
    expect(pickRate(more, 'USD', 'RUB', '2026-10-18')!.rate).toBe(parseRate('95'));
    expect(pickRate(more, 'USD', 'RUB', '2026-10-16')!.rate).toBe(parseRate('90'));
  });

  it('prefers a manual rate over an imported one on the same date', () => {
    const rows = [
      { base: 'USD' as const, quote: 'ARS' as const, rate: parseRate('1000'), date: '2026-10-15', source: 'open.er-api.com' },
      { base: 'USD' as const, quote: 'ARS' as const, rate: parseRate('1450'), date: '2026-10-15', source: 'manual' },
    ];
    expect(pickRate(rows, 'USD', 'ARS', '2026-10-16')!.rate).toBe(parseRate('1450'));
    expect(pickRate([...rows].reverse(), 'USD', 'ARS', '2026-10-16')!.rate).toBe(parseRate('1450'));
  });

  it('identity for the same currency', () => {
    expect(snapshotFx(rub('5'), 'RUB', 'RUB', [], '2026-10-18')).toMatchObject({ baseAmount: rub('5') });
  });
});

import { sumInCurrency } from './fx';

describe('sumInCurrency', () => {
  it('converts what it can and reports the rest', () => {
    const r = sumInCurrency(
      [{ currency: 'RUB', amount: rub('1000') }, { currency: 'USD', amount: rub('10') }],
      'RUB', rates, '2026-10-16',
    );
    expect(r.total).toBe(rub('1900'));
    expect(r.unconverted).toEqual([]);
    const none = sumInCurrency([{ currency: 'USD', amount: rub('10') }], 'RUB', [], '2026-10-16');
    expect(none).toEqual({ total: 0n, unconverted: [{ currency: 'USD', amount: rub('10') }] });
  });
});
