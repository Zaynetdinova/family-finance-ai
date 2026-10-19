import { describe, expect, it } from 'vitest';
import { buildReport, renderReport, type ReportInput } from './build';
import { summarize } from '@/lib/finance/summary';
import { comparePeriods } from '@/lib/finance/compare';
import { categories, rub, tx } from '@/lib/finance/fixtures';

const base = { mode: 'base', currency: 'RUB' } as const;
const names = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Без категории';
const sept = { from: '2026-09-01', to: '2026-09-30' };
const oct = { from: '2026-10-01', to: '2026-10-31' };

const prevTxs = [
  tx({ type: 'income', amount: rub('120000'), occurredOn: '2026-09-05' }),
  tx({ type: 'expense', amount: rub('20000'), categoryId: 'c-food', occurredOn: '2026-09-10' }),
];
const curTxs = [
  tx({ type: 'income', amount: rub('120000'), occurredOn: '2026-10-05' }),
  tx({ type: 'expense', amount: rub('30000'), categoryId: 'c-food', occurredOn: '2026-10-10', counterparty: 'Магнит' }),
  tx({ type: 'expense', amount: rub('30000'), categoryId: 'c-home', occurredOn: '2026-10-03' }),
  tx({ type: 'debt_payment', amount: rub('10000'), principal: rub('6000'), interest: rub('4000'), fee: 0n, categoryId: 'c-debt', occurredOn: '2026-10-15' }),
];

function input(over: Partial<ReportInput> = {}): ReportInput {
  const summary = summarize(curTxs, { range: oct, view: base, asOf: '2026-11-01', categories });
  const previous = summarize(prevTxs, { range: sept, view: base, asOf: '2026-11-01', categories });
  return {
    kind: 'monthly', currency: 'RUB', periodLabel: 'октябрь 2026', previousLabel: 'сентябрь 2026', summary, comparison: comparePeriods(summary, previous),
    categoryName: names, limits: [{ name: 'Продукты', state: 'exceeded', usedBp: 15000, spent: rub('30000'), limit: rub('20000') }], dailyLimit: null,
    upcoming: [{ debtId: 'd', name: 'Ипотека', currency: 'RUB', amount: rub('40000'), date: '2026-11-25', overdue: false }],
    unusual: [], duplicateGroups: 0, goals: [{ name: 'Отпуск', currency: 'RUB', progressBp: 2500, requiredPerMonth: rub('15000'), achieved: false }],
    debtTotals: [{ currency: 'RUB', amount: rub('4794000') }], available: { available: rub('16000'), shortfall: 0n },
    nextMonthForecast: { expense: rub('20000'), months: 1 }, highestRateDebt: { name: 'Ипотека', rate: '9.5' }, ...over,
  };
}

describe('buildReport (monthly)', () => {
  const r = buildReport(input());
  const text = r.facts;
  it('includes the required sections with numbers computed by code', () => {
    expect(text).toContain('Доходы: 120');
    expect(text).toContain('Расходы: 64'); // 30000 + 30000 + 4000 interest; principal excluded
    expect(text).toContain('профицит');
    expect(text).toMatch(/Расходы к предыдущему периоду \(сентябрь 2026\): \+220,0%/);
    expect(text).toContain('Крупнейшие расходы:');
    expect(text).toContain('Магнит');
    expect(text).toContain('Постоянные расходы:');
    expect(text).toContain('Продукты: 30');
    expect(text).toContain('Цели:');
    expect(text).toContain('Остаток долгов:');
    expect(text).toContain('Погашено основного долга за период: 6');
    expect(text).toContain('Уплачено процентов и комиссий: 4');
    expect(text).toContain('Ближайшие обязательные платежи:');
    expect(text).toContain('После обязательных платежей остаётся');
    expect(text).toContain('Ориентир расходов на следующий месяц');
  });
  it('gives at most three rule-based recommendations tied to the data', () => {
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.recommendations.length).toBeLessThanOrEqual(3);
    expect(r.recommendations[0]).toContain('Продукты');
  });
  it('never recommends extra debt payments when mandatory payments are not covered', () => {
    const tight = buildReport(input({ available: { available: 0n, shortfall: rub('5000') }, limits: [] }));
    expect(tight.recommendations.join(' ')).not.toContain('самой высокой ставкой');
  });
  it('says comparison is impossible without previous data and when there is no data at all', () => {
    const summary = summarize(curTxs, { range: oct, view: base, asOf: '2026-11-01', categories });
    const empty = summarize([], { range: sept, view: base, asOf: '2026-11-01' });
    expect(buildReport(input({ comparison: comparePeriods(summary, empty) })).facts).toContain('нет данных за прошлый период');
    const none = buildReport(input({ summary: empty, comparison: comparePeriods(empty, empty) }));
    expect(none.facts).toContain('операций нет');
    expect(none.recommendations).toEqual([]);
  });
  it('marks unfinished periods as preliminary and says when forecast lacks history', () => {
    const summary = summarize(curTxs, { range: oct, view: base, asOf: '2026-10-20', categories });
    const r2 = buildReport(input({ summary, nextMonthForecast: null }));
    expect(r2.facts).toContain('предварительные');
    expect(r2.facts).toContain('недостаточно истории');
  });
});

describe('daily report and rendering', () => {
  it('daily: totals, top categories and daily limit; no comparison section', () => {
    const summary = summarize(curTxs, { range: { from: '2026-10-10', to: '2026-10-10' }, view: base, asOf: '2026-10-11', categories });
    const r = buildReport(input({ kind: 'daily', summary, dailyLimit: rub('25000') }));
    expect(r.facts).toContain('Расходы: 30');
    expect(r.facts).toContain('Дневной лимит');
    expect(r.facts).not.toContain('предыдущему периоду');
  });
  it('escapes content and labels AI text separately from facts', () => {
    const r = buildReport(input());
    const html = renderReport(r, { summary: 'Итог <ok>', recommendations: ['Сократить кафе'] }, (s) => s.replace(/</g, '&lt;'));
    expect(html).toContain('Комментарий AI');
    expect(html).toContain('Итог &lt;ok>');
    expect(html).toContain('1. Сократить кафе');
  });
});
