import { describe, expect, it } from 'vitest';
import { buildInsights } from './insights';
import { summarize } from './summary';
import { comparePeriods } from './compare';
import { categories, rub, tx } from './fixtures';

const base = { mode: 'base', currency: 'RUB' } as const;
const names = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Без категории';

describe('buildInsights', () => {
  const cur = summarize([tx({ type: 'expense', amount: rub('30000'), categoryId: 'c-food', occurredOn: '2026-10-05' }), tx({ type: 'income', amount: rub('10000'), occurredOn: '2026-10-02' })],
    { range: { from: '2026-10-01', to: '2026-10-31' }, view: base, asOf: '2026-10-10', categories });
  const prev = summarize([], { range: { from: '2026-09-01', to: '2026-09-10' }, view: base, asOf: '2026-10-10' });

  it('returns nothing without data', () => {
    const empty = summarize([], { range: { from: '2026-10-01', to: '2026-10-31' }, view: base, asOf: '2026-10-10' });
    expect(buildInsights({ summary: empty, comparison: comparePeriods(empty, prev), currency: 'RUB', categoryName: names, budgetAlerts: [], overduePayments: 0, unusualCount: 0 })).toEqual([]);
  });

  it('states facts, warns about deficit and says when comparison is impossible', () => {
    const texts = buildInsights({ summary: cur, comparison: comparePeriods(cur, prev), currency: 'RUB', categoryName: names, budgetAlerts: [{ name: 'Продукты', state: 'exceeded', usedBp: 12000 }], overduePayments: 1, unusualCount: 2 }).map((x) => x.text);
    expect(texts.some((t) => t.includes('предварительные'))).toBe(true);
    expect(texts.some((t) => t.includes('Расходы превысили доходы на') && t.includes('20'))).toBe(true);
    expect(texts.some((t) => t.includes('«Продукты»') && t.includes('100,0%'))).toBe(true);
    expect(texts.some((t) => t.includes('Сравнение') && t.includes('нет операций'))).toBe(true);
    expect(texts.some((t) => t.includes('превышен (120,0%)'))).toBe(true);
    expect(texts.some((t) => t.includes('Просроченных'))).toBe(true);
  });
});
