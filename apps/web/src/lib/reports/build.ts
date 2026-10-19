import { type Currency, type Minor, bpToPercent, formatMinor, ratioBp } from '@/lib/finance/money';
import type { PeriodSummary } from '@/lib/finance/summary';
import type { Comparison } from '@/lib/finance/compare';
import type { UpcomingPayment } from '@/lib/finance/debts';
import type { UnusualExpense } from '@/lib/finance/anomalies';
import type { LimitState } from '@/lib/finance/budget';

export type ReportKind = 'daily' | 'weekly' | 'monthly';

export interface ReportInput {
  kind: ReportKind;
  currency: Currency;
  periodLabel: string;
  previousLabel: string;
  summary: PeriodSummary;
  comparison: Comparison;
  categoryName: (id: string | null) => string;
  limits: { name: string; state: LimitState; usedBp: number | null; spent: Minor; limit: Minor }[];
  dailyLimit: Minor | null;
  upcoming: UpcomingPayment[];
  unusual: UnusualExpense[];
  duplicateGroups: number;
  goals: { name: string; currency: Currency; progressBp: number | null; requiredPerMonth: Minor | null; achieved: boolean }[];
  /** Outstanding principal per currency, as display text (never summed across currencies here). */
  debtTotals: { currency: Currency; amount: Minor }[];
  available: { available: Minor; shortfall: Minor } | null;
  /** Average monthly expense of the last complete months, used as next-month forecast. */
  nextMonthForecast: { expense: Minor; months: number } | null;
  highestRateDebt: { name: string; rate: string } | null;
}

export interface BuiltReport {
  title: string;
  /** Lines in Telegram HTML; every number here comes from code. */
  lines: string[];
  /** The same facts as plain text — the only input given to the language model. */
  facts: string;
  /** Rule-based recommendations, used when AI is off or its text is not grounded in facts. */
  recommendations: string[];
}

const pctText = (bp: number | null, signed = false) =>
  bp === null ? '—' : `${signed && bp > 0 ? '+' : ''}${(bpToPercent(bp) ?? 0).toFixed(1).replace('.', ',')}%`;

const TITLES: Record<ReportKind, string> = { daily: 'Сводка за день', weekly: 'Сводка за неделю', monthly: 'Финансовый отчёт за месяц' };

export function buildReport(i: ReportInput): BuiltReport {
  const c = i.currency;
  const m = (v: Minor) => formatMinor(v, c);
  const s = i.summary;
  const lines: string[] = [];
  const add = (l: string) => lines.push(l);

  if (!s.hasData) {
    add(`За период (${i.periodLabel}) операций нет — сводку составить не из чего.`);
    return { title: TITLES[i.kind], lines, facts: lines.join('\n'), recommendations: [] };
  }
  if (s.provisional) add('Период ещё не завершён: показатели предварительные.');
  add(`Период: ${i.periodLabel}. Валюта: ${c}.`);

  // 1–4. result, income, expense, difference
  add(`Доходы: ${m(s.income)}.`);
  add(`Расходы: ${m(s.expense)}.`);
  add(`Разница: ${m(s.net)} (${s.net >= 0n ? 'профицит' : 'дефицит'}).`);
  if (i.kind !== 'daily' && s.savingsRateBp !== null) add(`Доля сбережений: ${pctText(s.savingsRateBp)}.`);

  // 5. change vs previous
  if (i.kind !== 'daily') {
    if (i.comparison.comparable) {
      const e = i.comparison.expense;
      add(`Расходы к предыдущему периоду (${i.previousLabel}): ${pctText(e.changeBp, true)} (было ${m(e.previous)}).`);
    } else {
      add(`Сравнение с предыдущим периодом невозможно: ${i.comparison.reason === 'no_previous_data' ? 'нет данных за прошлый период' : 'периоды несопоставимы'}.`);
    }
  }

  // 6–7. categories (and change by category)
  const topN = i.kind === 'monthly' ? 8 : 3;
  const cats = s.byCategory.filter((x) => x.expense > 0n).slice(0, topN);
  if (cats.length) {
    add('Основные категории расходов:');
    for (const x of cats) {
      let line = `• ${i.categoryName(x.categoryId)}: ${m(x.expense)} (${pctText(x.shareBp)})`;
      if (i.kind !== 'daily' && i.comparison.comparable) {
        const d = i.comparison.categories.find((y) => y.categoryId === x.categoryId);
        if (d?.isNew) line += ', новая категория расходов';
        else if (d && d.changeBp !== null && d.diff !== 0n) line += `, к прошлому периоду ${pctText(d.changeBp, true)}`;
      }
      add(line);
    }
  }

  // 8. largest expenses
  if (i.kind === 'monthly' && s.largestExpenses.length) {
    add('Крупнейшие расходы:');
    s.largestExpenses.slice(0, 10).forEach((e, k) => add(`${k + 1}) ${e.counterparty ?? i.categoryName(e.categoryId)}: ${m(e.amount)}, ${e.occurredOn}`));
  }

  // 9. fixed vs variable
  if (i.kind === 'monthly' && s.expense > 0n) {
    add(`Постоянные расходы: ${m(s.fixedExpense)} (${pctText(ratioBp(s.fixedExpense, s.expense))}); переменные: ${m(s.variableExpense)}.`);
  }
  if (i.kind !== 'daily' && s.avgDailyExpense !== null) add(`Средние расходы в день: ${m(s.avgDailyExpense)}.`);

  // daily budget
  if (i.kind === 'daily' && i.dailyLimit !== null) {
    add(s.expense > i.dailyLimit ? `Дневной лимит ${m(i.dailyLimit)} превышен на ${m(s.expense - i.dailyLimit)}.` : `Дневной лимит ${m(i.dailyLimit)}: осталось ${m(i.dailyLimit - s.expense)}.`);
  }

  // 10. unusual and duplicates
  if (i.unusual.length) {
    add('Необычно крупные операции:');
    for (const u of i.unusual.slice(0, 5)) add(`• ${i.categoryName(u.categoryId)}: ${m(u.amount)} (${u.occurredOn}), обычно ≈ ${m(u.median)}`);
  }
  if (i.kind === 'monthly' && i.duplicateGroups > 0) add(`Возможные дубликаты: ${i.duplicateGroups} групп(ы) похожих операций — проверьте.`);

  // budget limits
  if (i.kind !== 'daily') {
    const alerts = i.limits.filter((l) => l.state !== 'ok');
    if (alerts.length) {
      add('Бюджетные лимиты:');
      for (const l of alerts) add(`• ${l.name}: ${m(l.spent)} из ${m(l.limit)} (${pctText(l.usedBp)})${l.state === 'exceeded' ? ' — превышен' : ''}`);
    } else if (i.limits.length) add('Все лимиты по категориям соблюдаются.');
  }

  // 11. goals
  if (i.kind === 'monthly' && i.goals.length) {
    add('Цели:');
    for (const g of i.goals) add(`• ${g.name}: ${pctText(g.progressBp)}${g.achieved ? ', достигнута' : g.requiredPerMonth !== null ? `, нужно откладывать ${formatMinor(g.requiredPerMonth, g.currency)} в месяц` : ''}`);
  }

  // 12–13. debt
  if (i.kind === 'monthly') {
    if (i.debtTotals.length) add(`Остаток долгов: ${i.debtTotals.map((d) => formatMinor(d.amount, d.currency)).join(', ')}.`);
    if (s.debtPrincipalPaid > 0n) add(`Погашено основного долга за период: ${m(s.debtPrincipalPaid)}.`);
    if (s.interestAndFeesPaid > 0n) add(`Уплачено процентов и комиссий: ${m(s.interestAndFeesPaid)}.`);
  }

  // 14. upcoming payments
  if (i.kind !== 'daily' && i.upcoming.length) {
    add('Ближайшие обязательные платежи:');
    for (const p of i.upcoming.slice(0, 5)) add(`• ${p.name}: ${formatMinor(p.amount, p.currency)}, ${p.date}${p.overdue ? ' (просрочен)' : ''}`);
  }

  // 15. available after mandatory payments
  if (i.kind === 'monthly' && i.available) {
    add(i.available.shortfall > 0n
      ? `После обязательных платежей не хватает ${m(i.available.shortfall)}.`
      : `После обязательных платежей остаётся ${m(i.available.available)}.`);
  }

  // 16. forecast
  if (i.kind === 'monthly') {
    add(i.nextMonthForecast
      ? `Ориентир расходов на следующий месяц: ${m(i.nextMonthForecast.expense)} (среднее за ${i.nextMonthForecast.months} мес., приблизительно).`
      : 'Прогноз на следующий месяц: недостаточно истории (нужен хотя бы один полный месяц).');
  }

  if (s.unconverted.count > 0) add(`${s.unconverted.count} операц. без курса не вошли в суммы.`);

  const recommendations = ruleRecommendations(i);
  return { title: TITLES[i.kind], lines, facts: lines.join('\n'), recommendations };
}

/** 17. Rule-based recommendations: each one cites a number already present in the facts. */
export function ruleRecommendations(i: ReportInput): string[] {
  if (i.kind === 'daily' || !i.summary.hasData) return [];
  const out: string[] = [];
  const exceeded = i.limits.find((l) => l.state === 'exceeded');
  if (exceeded) out.push(`Лимит «${exceeded.name}» превышен: до конца месяца ограничьте траты в этой категории.`);
  if (i.comparison.comparable) {
    const grown = i.comparison.categories.find((x) => x.diff > 0n && !x.isNew && x.changeBp !== null && x.changeBp >= 2000);
    if (grown) out.push(`Расходы на «${i.categoryName(grown.categoryId)}» выросли на ${pctText(grown.changeBp, true)}: проверьте крупные покупки и установите лимит.`);
  }
  if (i.summary.net < 0n) out.push('Расходы превышают доходы: отложите необязательные покупки до выравнивания баланса.');
  else if (i.summary.savingsRateBp !== null && i.summary.savingsRateBp < 1000) out.push(`Доля сбережений ${pctText(i.summary.savingsRateBp)} — попробуйте откладывать хотя бы 10% дохода сразу после его поступления.`);
  if (i.highestRateDebt && (!i.available || i.available.shortfall === 0n)) {
    out.push(`Свободные деньги сверх резерва и обязательных платежей выгоднее направлять на долг с самой высокой ставкой — «${i.highestRateDebt.name}» (${i.highestRateDebt.rate}%).`);
  }
  if (i.duplicateGroups > 0) out.push('Проверьте возможные дубликаты операций — они завышают расходы.');
  return out.slice(0, 3);
}

export function renderReport(r: BuiltReport, ai: { summary: string; recommendations: string[] } | null, esc: (s: string) => string): string {
  const parts = [`<b>${esc(r.title)}</b>`, ...r.lines.map(esc)];
  if (ai) {
    parts.push('', '<b>Комментарий AI</b> (по фактам выше)', esc(ai.summary));
    if (ai.recommendations.length) parts.push('', '<b>Рекомендации</b>', ...ai.recommendations.map((x, k) => `${k + 1}. ${esc(x)}`));
  } else if (r.recommendations.length) {
    parts.push('', '<b>Рекомендации</b>', ...r.recommendations.map((x, k) => `${k + 1}. ${esc(x)}`));
  }
  return parts.join('\n');
}
