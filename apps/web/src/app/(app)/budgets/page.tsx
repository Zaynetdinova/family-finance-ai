import type { Metadata } from 'next';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, Notice } from '@/components/ui/states';
import { StatCard } from '@/components/stat-card';
import { ActionForm, FormField } from '@/components/action-form';
import { ContributeForm, DeleteGoalButton, RemoveLimitButton } from '@/components/budget-controls';
import { createGoal, setCategoryLimit, setDailyLimit } from '@/lib/actions/budgets';
import { loadRecentRates, requireContext } from '@/lib/db/queries';
import { debtSchedule, rateRow, toMinor } from '@/lib/db/convert';
import { loadBudget, loadDebtPayments, loadReport, one, type SearchParams } from '@/lib/report';
import { availableToSave, goalProgress, limitStatus, rollUpByCategory } from '@/lib/finance/budget';
import { upcomingPayments } from '@/lib/finance/debts';
import { sumInCurrency } from '@/lib/finance/fx';
import { summarize } from '@/lib/finance/summary';
import { addDays, endOfMonth } from '@/lib/finance/dates';
import { parseAmount } from '@/lib/finance/money';
import { dateShort, money, pct } from '@/lib/format';
import { CURRENCY_OPTIONS } from '@/lib/labels';
import { PiggyBank } from 'lucide-react';

export const metadata: Metadata = { title: 'Бюджеты и цели' };

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const base = ctx.household.base_currency;
  const canWrite = ['owner', 'admin', 'member'].includes(ctx.role);

  let report, budget, goals, payments, rates;
  try {
    // Budgets are always evaluated for the current month in the reporting currency.
    report = await loadReport(ctx, { period: 'month' });
    [budget, payments, rates] = await Promise.all([
      loadBudget(ctx, `${ctx.today.slice(0, 7)}-01`, base),
      loadDebtPayments(ctx, addDays(ctx.today, -62)),
      loadRecentRates(ctx),
    ]);
    const g = await ctx.supabase.from('financial_goals').select('*').eq('household_id', ctx.household.id).order('created_at');
    if (g.error) throw new Error(g.error.message);
    goals = g.data as import('@/lib/db/types').GoalRow[];
  } catch (e) {
    return <ErrorState message={e instanceof Error ? e.message : undefined} />;
  }

  const { current, categories, categoryName } = report;
  const spent = rollUpByCategory(current.byCategory, categories);
  const limits = (budget?.limits ?? []).map((l) => ({ ...l, status: limitStatus(toMinor(l.limit_amount), spent.get(l.category_id) ?? 0n), name: categoryName(l.category_id) }));

  // Mandatory payments still due this month, converted to the reporting currency when a rate exists.
  const monthEnd = endOfMonth(ctx.today);
  const dueThisMonth = upcomingPayments(ctx.debts.map(debtSchedule), payments.map((p) => ({ debtId: p.debt_id, paidOn: p.paid_on })), ctx.today, 31).filter((p) => p.date <= monthEnd);
  const due = sumInCurrency(dueThisMonth.map((p) => ({ currency: p.currency, amount: p.amount })), base, rates.map(rateRow), ctx.today);

  let reserve = 0n;
  const reserveRaw = one(sp.reserve);
  if (reserveRaw && /^\d{1,12}(?:[.,]\d{1,2})?$/.test(reserveRaw)) reserve = parseAmount(reserveRaw);
  const save = availableToSave({ income: current.income, expense: current.expense, upcomingMandatory: due.total, reserve });

  const today = summarize(report.txs, { range: { from: ctx.today, to: ctx.today }, view: report.view, asOf: ctx.today });
  const dailyLimit = budget?.budget.daily_limit != null ? toMinor(budget.budget.daily_limit) : null;
  const expenseCats = ctx.categories.filter((c) => c.kind === 'expense');

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Бюджеты и цели</h1>
        <p className="text-sm text-text-secondary">Текущий месяц · {base}{current.provisional ? ' · предварительно' : ''}</p>
      </div>

      <section aria-label="Доступно для накоплений" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Доступно для накоплений" value={current.hasData ? money(save.available, base) : '—'} tone={save.shortfall > 0n ? 'negative' : undefined}
          hint={save.shortfall > 0n ? `не хватает ${money(save.shortfall, base)}` : 'доходы − расходы − обязательные платежи − резерв'} />
        <StatCard label="Доходы / расходы" value={current.hasData ? `${money(current.income, base)} / ${money(current.expense, base)}` : '—'} hint="с начала месяца" />
        <StatCard label="Обязательные платежи до конца месяца" value={money(due.total, base)} hint={due.unconverted.length ? 'без части платежей в других валютах: нет курса' : `${dueThisMonth.length} платеж(ей)`} />
        <StatCard label="Сегодня потрачено" value={today.hasData ? money(today.expense, base) : '—'}
          hint={dailyLimit !== null ? `дневной лимит ${money(dailyLimit, base)}${today.expense > dailyLimit ? ' — превышен' : ''}` : 'дневной лимит не задан'} />
      </section>

      <form className="flex items-end gap-2" role="search" aria-label="Резерв">
        <label className="flex flex-col gap-1 text-xs text-text-secondary">Минимальный резерв, {base}
          <Input name="reserve" inputMode="decimal" defaultValue={reserveRaw ?? ''} placeholder="0" className="w-40" />
        </label>
        <button className="min-h-9 rounded-lg border border-border px-3 text-sm hover:bg-surface-muted" type="submit">Пересчитать</button>
      </form>
      {save.shortfall > 0n ? <Notice>В этом месяце доходов пока не хватает на расходы, обязательные платежи и резерв. Не направляйте на накопления и досрочное погашение средства, которые нужны на обязательные траты.</Notice> : null}

      <Card>
        <CardHeader><CardTitle>Лимиты по категориям</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          {limits.length === 0 ? <p className="text-sm text-text-muted">Лимитов на этот месяц нет.</p> : (
            <ul className="flex flex-col gap-3">
              {limits.map((l) => (
                <li key={l.id} className="text-sm">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">{l.name}
                      {l.status.state === 'exceeded' ? <Badge tone="negative">превышен</Badge> : l.status.state === 'warning' ? <Badge tone="warning">близко к лимиту</Badge> : null}
                    </span>
                    <span className="tabular flex items-center gap-2 text-text-secondary">
                      {money(spent.get(l.category_id) ?? 0n, base)} из {money(toMinor(l.limit_amount), base)} · {pct(l.status.usedBp)}
                      {canWrite ? <RemoveLimitButton id={l.id} name={l.name} /> : null}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-muted" role="progressbar" aria-label={`Использовано по «${l.name}»`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round((l.status.usedBp ?? 0) / 100))}>
                    <div className="h-2 rounded-full" style={{ width: `${Math.min(100, (l.status.usedBp ?? 0) / 100)}%`, background: l.status.state === 'exceeded' ? 'var(--series-8)' : l.status.state === 'warning' ? 'var(--series-4)' : 'var(--series-3)' }} />
                  </div>
                  <p className="mt-1 text-xs text-text-muted">{l.status.remaining >= 0n ? `осталось ${money(l.status.remaining, base)}` : `превышение ${money(-l.status.remaining, base)}`}</p>
                </li>
              ))}
            </ul>
          )}
          {canWrite ? (
            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <ActionForm action={setCategoryLimit} submitLabel="Задать лимит">
                <FormField label="Категория" name="categoryId">
                  <Select name="categoryId" defaultValue=""><option value="">Выберите…</option>{expenseCats.map((c) => <option key={c.id} value={c.id}>{categoryName(c.id)}</option>)}</Select>
                </FormField>
                <FormField label={`Лимит на месяц, ${base}`} name="amount"><Input name="amount" inputMode="decimal" /></FormField>
              </ActionForm>
              <ActionForm action={setDailyLimit} submitLabel="Сохранить" resetOnSuccess={false}>
                <FormField label={`Дневной лимит, ${base} (пусто — снять)`} name="amount"><Input name="amount" inputMode="decimal" defaultValue={dailyLimit !== null ? String(budget!.budget.daily_limit) : ''} /></FormField>
              </ActionForm>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Финансовые цели</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          {goals.length === 0 ? (
            <EmptyState icon={<PiggyBank className="h-8 w-8" aria-hidden />} title="Целей пока нет" description="Задайте сумму и срок, например «Отпуск» или «Подушка безопасности» — здесь будет прогресс и сколько откладывать в месяц." />
          ) : (
            <ul className="flex flex-col gap-4">
              {goals.map((g) => {
                const p = goalProgress({ target: toMinor(g.target_amount), current: toMinor(g.current_amount), targetDate: g.target_date, today: ctx.today });
                return (
                  <li key={g.id} className="rounded-lg border border-border p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-medium">{g.name} {p.achieved ? <Badge tone="positive">достигнута</Badge> : null}</h3>
                      {canWrite ? <DeleteGoalButton id={g.id} name={g.name} /> : null}
                    </div>
                    <div className="tabular mb-1.5 flex justify-between text-sm"><span>{money(toMinor(g.current_amount), g.currency)} из {money(toMinor(g.target_amount), g.currency)}</span><span className="text-text-secondary">{pct(p.progressBp)}</span></div>
                    <div className="h-2 rounded-full bg-surface-muted" role="progressbar" aria-label={`Прогресс цели «${g.name}»`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((p.progressBp ?? 0) / 100)}>
                      <div className="h-2 rounded-full" style={{ width: `${(p.progressBp ?? 0) / 100}%`, background: 'var(--series-1)' }} />
                    </div>
                    <p className="mt-2 text-xs text-text-muted">
                      {p.achieved ? 'Цель достигнута.'
                        : g.target_date ? (p.monthsLeft ? `До ${dateShort(g.target_date, ctx.today.slice(0, 4))} (≈ ${p.monthsLeft} мес.) нужно откладывать ≈ ${money(p.requiredPerMonth!, g.currency)} в месяц.` : `Срок ${dateShort(g.target_date, ctx.today.slice(0, 4))} прошёл, осталось ${money(p.remaining, g.currency)}.`)
                        : `Осталось накопить ${money(p.remaining, g.currency)}. Срок не задан.`}
                    </p>
                    {canWrite && !p.achieved ? <div className="mt-3"><ContributeForm id={g.id} /></div> : null}
                  </li>
                );
              })}
            </ul>
          )}
          {canWrite ? (
            <ActionForm action={createGoal} submitLabel="Создать цель">
              <div className="grid gap-3 sm:grid-cols-5">
                <FormField label="Название" name="name" className="sm:col-span-2"><Input name="name" required /></FormField>
                <FormField label="Валюта" name="currency"><Select name="currency" defaultValue={base}>{CURRENCY_OPTIONS}</Select></FormField>
                <FormField label="Цель" name="targetAmount"><Input name="targetAmount" inputMode="decimal" required /></FormField>
                <FormField label="Уже накоплено" name="currentAmount"><Input name="currentAmount" inputMode="decimal" defaultValue="0" /></FormField>
                <FormField label="Срок (необязательно)" name="targetDate"><Input name="targetDate" type="date" /></FormField>
              </div>
            </ActionForm>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
