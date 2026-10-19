import 'server-only';
import type { AppContext } from '@/lib/db/queries';
import { debtSchedule, rateRow, toMinor, txFromRow } from '@/lib/db/convert';
import { loadRecentRates, loadTransactions } from '@/lib/db/queries';
import { categoryNamer, debtDirections, loadBalances, loadDebtPayments } from '@/lib/report';
import { addDays, daysInRange, isIsoDate, previousComparableRange, startOfMonth, type DateRange } from '@/lib/finance/dates';
import { summarize } from '@/lib/finance/summary';
import { comparePeriods } from '@/lib/finance/compare';
import { upcomingPayments } from '@/lib/finance/debts';
import { availableToSave, rollUpByCategory } from '@/lib/finance/budget';
import { sumInCurrency } from '@/lib/finance/fx';
import { categoryRef } from '@/lib/db/convert';
import { bpToPercent, CURRENCIES, formatMinor } from '@/lib/finance/money';
import { esc, dateRu } from '@/lib/telegram/format';
import type { MessageAnalysis } from '@/lib/ai/schemas';
import { questionRange } from './question-range';

const pct = (bp: number | null, signed = false) => (bp === null ? '—' : `${signed && bp > 0 ? '+' : ''}${(bpToPercent(bp) ?? 0).toFixed(1).replace('.', ',')}%`);
const label = (r: DateRange) => (r.from === r.to ? dateRu(r.from) : `${dateRu(r.from)} — ${dateRu(r.to)}`);

/**
 * Answers a question about the user's finances. The model only chose the topic and the
 * dates; every number here is computed from the database by the same code as the dashboard.
 */
export async function answerQuestion(ctx: AppContext, q: MessageAnalysis): Promise<string> {
  const base = ctx.household.base_currency;
  const view = { mode: 'base', currency: base } as const;
  const catName = categoryNamer(ctx);
  const cats = ctx.categories.map(categoryRef);
  const m = (v: bigint) => esc(formatMinor(v, base));
  const range = questionRange(q.period_from, q.period_to, ctx.today);
  const dirs = debtDirections(ctx);
  const load = async (r: DateRange) => (await loadTransactions(ctx, { from: r.from, to: r.to })).map((row) => txFromRow(row, dirs));
  const noData = (r: DateRange) => `За период ${label(r)} операций нет — ответить нечем.`;

  switch (q.question_topic) {
    case 'spending_total':
    case 'income_total':
    case 'top_categories':
    case 'category_spending': {
      const s = summarize(await load(range), { range, view, asOf: ctx.today, categories: cats });
      if (!s.hasData) return noData(range);
      const head = `<b>${label(range)}</b>${s.provisional ? ' (период не завершён)' : ''}`;
      const unconv = s.unconverted.count ? `\n${s.unconverted.count} операц. без курса не учтены.` : '';
      if (q.question_topic === 'income_total') return `${head}\nДоходы: ${m(s.income)}.${unconv}`;
      if (q.question_topic === 'category_spending') {
        const hint = (q.category_hint ?? '').toLowerCase().trim();
        const cat = ctx.categories.find((c) => c.name.toLowerCase() === hint) ?? ctx.categories.find((c) => hint && c.name.toLowerCase().includes(hint));
        if (!cat) return `${head}\nНе нашёл категорию «${esc(q.category_hint ?? '')}». Расходы всего: ${m(s.expense)}.`;
        const spent = rollUpByCategory(s.byCategory, cats).get(cat.id) ?? 0n;
        return `${head}\nНа «${esc(catName(cat.id))}» потрачено ${m(spent)} (${pct(s.expense > 0n ? Number((spent * 10000n) / s.expense) : null)} всех расходов).${unconv}`;
      }
      if (q.question_topic === 'top_categories') {
        const top = s.byCategory.filter((x) => x.expense > 0n).slice(0, 5);
        return `${head}\nРасходы: ${m(s.expense)}. Больше всего:\n${top.map((x, k) => `${k + 1}. ${esc(catName(x.categoryId))} — ${m(x.expense)} (${pct(x.shareBp)})`).join('\n')}${unconv}`;
      }
      return `${head}\nРасходы: ${m(s.expense)}. Доходы: ${m(s.income)}. Разница: ${m(s.net)}.${unconv}`;
    }

    case 'compare_periods': {
      const other = q.compare_from && q.compare_to ? questionRange(q.compare_from, q.compare_to, ctx.today) : previousComparableRange(range, ctx.today);
      const [a, b] = other.from < range.from ? [other, range] : [range, other];
      const txs = await load({ from: a.from, to: b.to });
      const sa = summarize(txs, { range: a, view, asOf: ctx.today, categories: cats });
      const sb = summarize(txs, { range: b, view, asOf: ctx.today, categories: cats });
      const c = comparePeriods(sb, sa);
      if (!c.comparable) {
        const why = { no_previous_data: `за ${label(a)} нет данных`, no_current_data: `за ${label(b)} нет данных`, different_length: 'периоды разной длины', different_currency: 'разные валюты' }[c.reason];
        return `Сравнить нельзя: ${why}.`;
      }
      const moved = c.categories.filter((x) => x.diff !== 0n).slice(0, 3)
        .map((x) => `• ${esc(catName(x.categoryId))}: ${x.diff > 0n ? '+' : '−'}${m(x.diff < 0n ? -x.diff : x.diff)}${x.changeBp !== null ? ` (${pct(x.changeBp, true)})` : ''}`);
      return [
        `<b>${label(b)}</b> к <b>${label(a)}</b>${c.provisional ? ' (предварительно)' : ''}`,
        `Расходы: ${m(c.expense.current)} против ${m(c.expense.previous)} (${pct(c.expense.changeBp, true)}).`,
        `Доходы: ${m(c.income.current)} против ${m(c.income.previous)}.`,
        moved.length ? `Сильнее всего изменились:\n${moved.join('\n')}` : '',
      ].filter(Boolean).join('\n');
    }

    case 'upcoming_payments': {
      const horizonEnd = q.period_to && isIsoDate(q.period_to) && q.period_to > ctx.today ? q.period_to : addDays(ctx.today, 7);
      const payments = await loadDebtPayments(ctx, addDays(ctx.today, -62));
      const list = upcomingPayments(ctx.debts.map(debtSchedule), payments.map((p) => ({ debtId: p.debt_id, paidOn: p.paid_on })), ctx.today, Math.min(90, daysInRange(ctx.today, horizonEnd)))
        .filter((p) => p.date <= horizonEnd);
      if (!list.length) return `До ${dateRu(horizonEnd)} обязательных платежей нет (учитываются долги с указанными днём и суммой платежа).`;
      return `<b>Платежи до ${dateRu(horizonEnd)}</b>\n${list.map((p) => `• ${dateRu(p.date)} — ${esc(p.name)}: ${esc(formatMinor(p.amount, p.currency))}${p.overdue ? ' (просрочен)' : ''}`).join('\n')}`;
    }

    case 'debt_strategy': {
      const owed = ctx.debts.filter((d) => d.status === 'active' && d.direction === 'owed_by_me');
      if (!owed.length) return 'Активных долгов нет.';
      const byRate = [...owed].sort((x, y) => Number(y.interest_rate ?? -1) - Number(x.interest_rate ?? -1));
      const byBalance = [...owed].sort((x, y) => (toMinor(x.current_balance) < toMinor(y.current_balance) ? -1 : 1));
      const line = (d: (typeof owed)[number]) => `${esc(d.name)} — ${esc(formatMinor(toMinor(d.current_balance), d.currency))}${d.interest_rate !== null ? `, ${d.interest_rate}%` : ', ставка не указана'}`;
      return [
        '<b>Порядок погашения</b>',
        'Сначала всегда вносите минимальные платежи по всем долгам и сохраняйте резерв.',
        `Лавина (меньше переплата): лишние деньги — на долг с самой высокой ставкой:\n${byRate.map((d, k) => `${k + 1}. ${line(d)}`).join('\n')}`,
        `Снежный ком (быстрее закрываются долги): сначала самый маленький остаток:\n${byBalance.map((d, k) => `${k + 1}. ${line(d)}`).join('\n')}`,
        owed.some((d) => d.interest_rate === null) ? 'У части долгов не указана ставка — порядок по «лавине» приблизительный.' : '',
      ].filter(Boolean).join('\n\n');
    }

    case 'savings_capacity': {
      const monthRange = { from: startOfMonth(ctx.today), to: ctx.today };
      const s = summarize(await load(monthRange), { range: monthRange, view, asOf: ctx.today, categories: cats });
      const payments = await loadDebtPayments(ctx, addDays(ctx.today, -62));
      const due = upcomingPayments(ctx.debts.map(debtSchedule), payments.map((p) => ({ debtId: p.debt_id, paidOn: p.paid_on })), ctx.today, 31)
        .filter((p) => p.date.slice(0, 7) === ctx.today.slice(0, 7));
      const dueSum = sumInCurrency(due.map((p) => ({ currency: p.currency, amount: p.amount })), base, (await loadRecentRates(ctx)).map(rateRow), ctx.today);
      const a = availableToSave({ income: s.income, expense: s.expense, upcomingMandatory: dueSum.total, reserve: 0n });
      return [
        `<b>С начала месяца</b> (предварительно)`,
        `Доходы ${m(s.income)} − расходы ${m(s.expense)} − оставшиеся обязательные платежи ${m(dueSum.total)}`,
        a.shortfall > 0n ? `= не хватает ${m(a.shortfall)}. Откладывать сейчас не из чего.` : `= можно отложить до ${m(a.available)}, если не нужны ещё расходы до конца месяца. Оставьте резерв на непредвиденное.`,
        dueSum.unconverted.length ? 'Часть платежей в другой валюте не учтена: нет курса.' : '',
      ].filter(Boolean).join('\n');
    }

    case 'balance': {
      const bal = await loadBalances(ctx);
      const accName = new Map(ctx.accounts.map((a) => [a.id, a.name]));
      const lines = [...bal].map(([id, b]) => `• ${esc(accName.get(id) ?? '')}: ${esc(formatMinor(b.balance, b.currency))}`);
      const totals = new Map<string, bigint>();
      for (const b of bal.values()) totals.set(b.currency, (totals.get(b.currency) ?? 0n) + b.balance);
      return `<b>Остатки</b>\n${lines.join('\n')}\n${CURRENCIES.filter((c) => totals.has(c)).map((c) => `Итого ${c}: ${esc(formatMinor(totals.get(c)!, c))}`).join('\n')}`;
    }

    default:
      return 'Я могу ответить на вопросы о расходах, доходах, категориях, сравнении периодов, платежах, долгах и накоплениях. Например: «Сколько мы потратили в этом месяце?»';
  }
}

