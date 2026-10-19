import 'server-only';
import { debtSchedule, toMinor } from '@/lib/db/convert';
import type { GoalRow } from '@/lib/db/types';
import { loadBudget, loadDebtPayments, loadReport } from '@/lib/report';
import { addDays, startOfMonth } from '@/lib/finance/dates';
import { estimatePayoff, percentToPpm, repaidBp, upcomingPayments } from '@/lib/finance/debts';
import { goalProgress, limitStatus, rollUpByCategory } from '@/lib/finance/budget';
import { buildInsights } from '@/lib/finance/insights';
import { bpToPercent, formatMinor } from '@/lib/finance/money';
import { collectReportInput, generateReport } from '@/lib/reports/load';
import { openAiConfigFromEnv } from '@/lib/ai/openai';
import { dateRu, esc } from '@/lib/telegram/format';
import { answerQuestion } from './questions';
import type { BotViews } from './handler';

const pct = (bp: number | null) => (bp === null ? '—' : `${(bpToPercent(bp) ?? 0).toFixed(1).replace('.', ',')}%`);

export function createBotViews(log?: (msg: string, meta?: Record<string, unknown>) => void): BotViews {
  return {
    async report(ctx, kind) {
      const input = await collectReportInput(ctx, kind);
      const r = await generateReport(input, openAiConfigFromEnv(), esc);
      if (r.ai === 'failed' || r.ai === 'rejected_ungrounded') log?.('report narrative not used', { reason: r.ai, error: r.error });
      if (r.usage) {
        await ctx.supabase.from('ai_interactions').insert({
          user_id: ctx.userId, household_id: ctx.household.id, channel: 'telegram', kind: `report_${kind}`,
          status: r.ai === 'used' ? 'ok' : r.ai === 'rejected_ungrounded' ? 'invalid_output' : 'error',
          error: r.error ?? (r.ai === 'rejected_ungrounded' ? 'narrative contained numbers not present in facts' : null),
          model: r.usage.model, tokens_in: r.usage.tokensIn, tokens_out: r.usage.tokensOut,
        });
      }
      return r.html;
    },

    async analytics(ctx) {
      const rep = await loadReport(ctx, { period: 'month' });
      const insights = buildInsights({
        summary: rep.current, comparison: rep.comparison, currency: rep.view.currency, categoryName: rep.categoryName,
        budgetAlerts: [], overduePayments: 0, unusualCount: rep.unusual.length,
      });
      if (!insights.length) return 'В этом месяце операций пока нет — выводов нет.';
      return `<b>Выводы за месяц</b>\n${insights.map((i) => `${i.tone === 'attention' ? '❗' : '•'} ${esc(i.text)}`).join('\n')}`;
    },

    async debts(ctx) {
      const owed = ctx.debts.filter((d) => d.status === 'active');
      if (!owed.length) return 'Активных долгов нет.';
      const payments = await loadDebtPayments(ctx, addDays(ctx.today, -62));
      const upcoming = upcomingPayments(ctx.debts.map(debtSchedule), payments.map((p) => ({ debtId: p.debt_id, paidOn: p.paid_on })), ctx.today, 30);
      const lines = owed.map((d) => {
        const bal = toMinor(d.current_balance);
        const est = d.direction === 'owed_by_me'
          ? estimatePayoff({ balance: bal, annualRatePpm: d.interest_rate === null ? null : percentToPpm(String(d.interest_rate)), monthlyPayment: d.min_payment === null ? null : toMinor(d.min_payment), from: ctx.today })
          : null;
        const close = est?.status === 'ok' ? `, закрытие ≈ ${dateRu(est.closeDate)} (приблизительно)` : est?.status === 'never' ? ', платёж не покрывает проценты' : '';
        return `• ${esc(d.name)}${d.direction === 'owed_to_me' ? ' (мне должны)' : ''}: ${esc(formatMinor(bal, d.currency))}, погашено ${pct(repaidBp(toMinor(d.original_amount), bal))}${d.interest_rate !== null ? `, ${d.interest_rate}%` : ''}${close}`;
      });
      const next = upcoming.length
        ? `\n<b>Платежи в ближайшие 30 дней</b>\n${upcoming.map((p) => `• ${dateRu(p.date)} — ${esc(p.name)}: ${esc(formatMinor(p.amount, p.currency))}${p.overdue ? ' (просрочен)' : ''}`).join('\n')}`
        : '\nВ ближайшие 30 дней платежей нет.';
      return `<b>Долги</b>\n${lines.join('\n')}\n${next}`;
    },

    async budget(ctx) {
      const base = ctx.household.base_currency;
      const rep = await loadReport(ctx, { period: 'month' });
      const b = await loadBudget(ctx, startOfMonth(ctx.today), base);
      const head = `<b>Бюджет за месяц</b> (предварительно)\nДоходы ${esc(formatMinor(rep.current.income, base))}, расходы ${esc(formatMinor(rep.current.expense, base))}.`;
      if (!b || !b.limits.length) return `${head}\nЛимиты не заданы — их можно установить в веб-приложении, раздел «Бюджеты».`;
      const spent = rollUpByCategory(rep.current.byCategory, rep.categories);
      const rows = b.limits.map((l) => {
        const st = limitStatus(toMinor(l.limit_amount), spent.get(l.category_id) ?? 0n);
        const icon = st.state === 'exceeded' ? '🔴' : st.state === 'warning' ? '🟡' : '🟢';
        return `${icon} ${esc(rep.categoryName(l.category_id))}: ${esc(formatMinor(spent.get(l.category_id) ?? 0n, base))} из ${esc(formatMinor(toMinor(l.limit_amount), base))} (${pct(st.usedBp)})`;
      });
      return `${head}\n${rows.join('\n')}`;
    },

    async goals(ctx) {
      const { data, error } = await ctx.supabase.from('financial_goals').select('*').eq('household_id', ctx.household.id).in('status', ['active', 'achieved']);
      if (error) throw new Error(error.message);
      const goals = data as GoalRow[];
      if (!goals.length) return 'Целей пока нет — создайте их в веб-приложении, раздел «Бюджеты».';
      return `<b>Цели</b>\n${goals.map((g) => {
        const p = goalProgress({ target: toMinor(g.target_amount), current: toMinor(g.current_amount), targetDate: g.target_date, today: ctx.today });
        const tail = p.achieved ? 'достигнута' : p.requiredPerMonth !== null ? `нужно ≈ ${esc(formatMinor(p.requiredPerMonth, g.currency))} в месяц` : `осталось ${esc(formatMinor(p.remaining, g.currency))}`;
        return `• ${esc(g.name)}: ${esc(formatMinor(toMinor(g.current_amount), g.currency))} из ${esc(formatMinor(toMinor(g.target_amount), g.currency))} (${pct(p.progressBp)}), ${tail}`;
      }).join('\n')}`;
    },

    answer: answerQuestion,
  };
}
