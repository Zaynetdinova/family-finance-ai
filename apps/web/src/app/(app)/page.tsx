import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, Notice } from '@/components/ui/states';
import { FilterBar } from '@/components/filter-bar';
import { StatCard } from '@/components/stat-card';
import { CategoryBars } from '@/components/charts/category-bars';
import { IncomeExpenseChart } from '@/components/charts/income-expense-chart';
import { TransactionFormDialog } from '@/components/transactions/transaction-form';
import { requireContext, loadRecentRates } from '@/lib/db/queries';
import { accountRef, debtSchedule, rateRow, toMinor } from '@/lib/db/convert';
import { loadBalances, loadBudget, loadDebtPayments, loadReport, one, type SearchParams } from '@/lib/report';
import { balancesByCurrency } from '@/lib/finance/ledger';
import { defaultBucket, timeSeries } from '@/lib/finance/series';
import { daysInRange, addDays } from '@/lib/finance/dates';
import { sumInCurrency } from '@/lib/finance/fx';
import { upcomingPayments } from '@/lib/finance/debts';
import { limitStatus, rollUpByCategory } from '@/lib/finance/budget';
import { buildInsights } from '@/lib/finance/insights';
import { CURRENCIES, type Currency } from '@/lib/finance/money';
import { dateShort, money, pct, rangeLabel, toChartNumber } from '@/lib/format';
import { TYPE_LABELS } from '@/lib/labels';

export const metadata: Metadata = { title: 'Обзор' };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await requireContext();

  let report, balances, rateRows, payments, budget;
  try {
    [report, balances, rateRows, payments] = await Promise.all([
      loadReport(ctx, sp),
      loadBalances(ctx),
      loadRecentRates(ctx),
      loadDebtPayments(ctx, addDays(ctx.today, -62)),
    ]);
    budget = await loadBudget(ctx, `${ctx.today.slice(0, 7)}-01`, report.view.currency);
  } catch (e) {
    return <ErrorState message={e instanceof Error ? e.message : undefined} />;
  }

  const { period, view, current, comparison, categoryName } = report;
  const cur = view.currency;
  const rates = rateRows.map(rateRow);
  const base = ctx.household.base_currency;
  const hasAnyTx = current.hasData || report.txs.length > 0;

  // Debts I owe, per currency; converted only when rates exist.
  const owed = ctx.debts.filter((d) => d.status === 'active' && d.direction === 'owed_by_me');
  const debtItems = owed.map((d) => ({ currency: d.currency, amount: toMinor(d.current_balance) }));
  const debtByCcy = new Map<Currency, bigint>();
  for (const d of debtItems) debtByCcy.set(d.currency, (debtByCcy.get(d.currency) ?? 0n) + d.amount);
  const debtView = view.mode === 'base' ? sumInCurrency(debtItems, base, rates, ctx.today) : null;

  const upcoming = upcomingPayments(ctx.debts.map(debtSchedule), payments.map((p) => ({ debtId: p.debt_id, paidOn: p.paid_on })), ctx.today, 30);
  const overdue = upcoming.filter((p) => p.overdue).length;

  // Budget alerts (only when the budget currency is the one shown)
  const budgetAlerts = [];
  if (budget) {
    const spent = rollUpByCategory(current.byCategory, report.categories);
    for (const l of budget.limits) {
      const st = limitStatus(toMinor(l.limit_amount), spent.get(l.category_id) ?? 0n);
      if (st.state !== 'ok') budgetAlerts.push({ name: categoryName(l.category_id), state: st.state, usedBp: st.usedBp });
    }
  }

  const insights = buildInsights({
    summary: current, comparison, currency: cur, categoryName, budgetAlerts, overduePayments: overdue, unusualCount: report.unusual.length,
  });

  const bucket = defaultBucket(daysInRange(period.from, period.to));
  const series = timeSeries(report.txs, { range: period, bucket, view }).map((p) => ({
    label: dateShort(p.start, ''), income: toChartNumber(p.income), expense: toChartNumber(p.expense),
  }));

  const accountName = new Map(ctx.accounts.map((a) => [a.id, a.name]));
  const recent = [...report.txs].filter((t) => t.status === 'confirmed').slice(-8).reverse();
  const totals = balancesByCurrency(balances);
  const balanceInBase = view.mode === 'base'
    ? sumInCurrency([...totals].map(([currency, amount]) => ({ currency, amount })), base, rates, ctx.today)
    : null;
  const net = current.net;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Обзор</h1>
          <p className="text-sm text-text-secondary">
            {rangeLabel(period.from, period.to)} · {view.mode === 'base' ? `все валюты в ${cur}` : `только ${cur}`}
            {current.provisional ? ' · предварительно' : ''}
          </p>
        </div>
        <TransactionFormDialog
          trigger={<Button><Plus className="h-4 w-4" aria-hidden /> Добавить операцию</Button>}
          accounts={ctx.accounts.filter((a) => !a.is_archived).map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
          categories={ctx.categories.map((c) => ({ id: c.id, name: categoryName(c.id), kind: c.kind }))}
          debts={owed.map((d) => ({ id: d.id, name: d.name, currency: d.currency }))}
        />
      </div>

      <FilterBar
        period={period.key} from={period.from} to={period.to} cur={one(sp.cur) ?? 'base'} user={report.userId ?? ''}
        baseCurrency={base} members={ctx.members}
      />

      {ctx.accounts.length === 0 ? (
        <EmptyState title="Добавьте первый счёт" description="Счета нужны, чтобы записывать операции и считать остатки." action={<Button asChild><Link href="/settings">Перейти в настройки</Link></Button>} />
      ) : !hasAnyTx ? (
        <EmptyState
          title="Операций пока нет"
          description="Добавьте первую операцию здесь или отправьте сообщение боту в Telegram (после подключения). Показатели появятся автоматически."
          action={
            <TransactionFormDialog
              trigger={<Button><Plus className="h-4 w-4" aria-hidden /> Добавить первую операцию</Button>}
              accounts={ctx.accounts.filter((a) => !a.is_archived).map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
              categories={ctx.categories.map((c) => ({ id: c.id, name: categoryName(c.id), kind: c.kind }))}
              debts={owed.map((d) => ({ id: d.id, name: d.name, currency: d.currency }))}
            />
          }
        />
      ) : (
        <>
          {current.unconverted.count > 0 ? (
            <Notice>
              {current.unconverted.count} операц. в другой валюте не вошли в суммы в {cur}: на дату операции нет курса. Обновите курсы в <Link className="underline" href="/settings">настройках</Link> или смотрите валюты по отдельности.
            </Notice>
          ) : null}

          <section aria-label="Ключевые показатели" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Доходы" value={current.hasData ? money(current.income, cur) : '—'} hint={current.hasData ? undefined : 'нет данных'} />
            <StatCard label="Расходы" value={current.hasData ? money(current.expense, cur) : '—'} hint={current.hasData ? `в день ≈ ${current.avgDailyExpense !== null ? money(current.avgDailyExpense, cur) : '—'}` : 'нет данных'} />
            <StatCard label="Разница" value={current.hasData ? money(net, cur) : '—'} tone={current.hasData ? (net >= 0n ? 'positive' : 'negative') : undefined} hint={net < 0n ? 'расходы больше доходов' : undefined} />
            <StatCard label="Доля сбережений" value={pct(current.savingsRateBp)} hint={current.savingsRateBp === null ? 'нет доходов в периоде' : '(доходы − расходы) / доходы'} />
            <StatCard
              label="Долги"
              value={
                owed.length === 0 ? '—'
                : debtView && debtView.unconverted.length === 0 ? money(debtView.total, base)
                : [...debtByCcy].map(([c, a]) => money(a, c)).join(' · ')
              }
              hint={owed.length === 0 ? 'долгов нет' : debtView && debtView.unconverted.length > 0 ? 'нет курса для сводной суммы' : 'остаток основного долга'}
            />
            <StatCard
              label="Сравнение расходов"
              value={comparison.comparable ? pct(comparison.expense.changeBp, { signed: true }) : '—'}
              hint={comparison.comparable ? `к ${rangeLabel(report.prevRange.from, report.prevRange.to)}` : 'сравнение невозможно'}
            />
          </section>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader><CardTitle>Доходы и расходы</CardTitle></CardHeader>
              <CardContent><IncomeExpenseChart data={series} currency={cur} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Расходы по категориям</CardTitle></CardHeader>
              <CardContent>
                <CategoryBars
                  currency={cur}
                  items={current.byCategory.map((c) => ({ id: c.categoryId, name: categoryName(c.categoryId), amount: c.expense, shareBp: c.shareBp }))}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardHeader><CardTitle>Остатки на счетах</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ul className="flex flex-col gap-2 text-sm">
                  {ctx.accounts.filter((a) => !a.is_archived).map((a) => (
                    <li key={a.id} className="flex items-baseline justify-between gap-3">
                      <span className="truncate">{a.name} <span className="text-text-muted">{a.currency}</span></span>
                      <span className="tabular">{money(balances.get(a.id)?.balance ?? 0n, a.currency)}</span>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-border pt-2 text-xs text-text-secondary">
                  {CURRENCIES.filter((c) => totals.has(c)).map((c) => (
                    <p key={c} className="tabular flex justify-between"><span>Итого {c}</span><span>{money(totals.get(c)!, c)}</span></p>
                  ))}
                  {balanceInBase && balanceInBase.unconverted.length === 0 && totals.size > 1 ? (
                    <p className="tabular mt-1 flex justify-between font-medium text-text"><span>≈ в {base} по курсу</span><span>{money(balanceInBase.total, base)}</span></p>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Ближайшие обязательные платежи</CardTitle></CardHeader>
              <CardContent>
                {upcoming.length === 0 ? (
                  <p className="text-sm text-text-muted">{owed.length === 0 ? 'Долгов нет.' : 'В ближайшие 30 дней платежей нет или у долгов не указан день платежа.'}</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {upcoming.slice(0, 6).map((p, i) => (
                      <li key={`${p.debtId}-${i}`} className="flex items-baseline justify-between gap-3">
                        <span className="truncate">{p.name} <span className="text-text-muted">· {dateShort(p.date, '')}</span> {p.overdue ? <Badge tone="negative">просрочен</Badge> : null}</span>
                        <span className="tabular">{money(p.amount, p.currency)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Выводы по данным</CardTitle></CardHeader>
              <CardContent>
                {insights.length === 0 ? <p className="text-sm text-text-muted">Недостаточно данных.</p> : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {insights.map((i, k) => (
                      <li key={k} className="flex gap-2">
                        <span aria-hidden className={i.tone === 'attention' ? 'text-warning' : 'text-text-muted'}>{i.tone === 'attention' ? '!' : '•'}</span>
                        <span><span className="sr-only">{i.tone === 'attention' ? 'Внимание: ' : ''}</span>{i.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-text-muted">Расчёт по вашим данным без участия языковой модели. Текстовые AI-сводки появятся после подключения OpenAI.</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Последние операции</CardTitle>
              <Link href="/transactions" className="text-xs text-text-secondary underline">Все операции</Link>
            </CardHeader>
            <CardContent>
              {recent.length === 0 ? <p className="text-sm text-text-muted">В выбранном периоде операций нет.</p> : (
                <ul className="divide-y divide-border text-sm">
                  {recent.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate">{t.counterparty || categoryName(t.categoryId ?? null)}</p>
                        <p className="truncate text-xs text-text-muted">{dateShort(t.occurredOn, ctx.today.slice(0, 4))} · {TYPE_LABELS[t.type]} · {accountName.get(t.accountId)}</p>
                      </div>
                      <span className={`tabular shrink-0 ${t.type === 'income' || t.type === 'refund' ? 'text-positive' : ''}`}>
                        {t.type === 'income' || t.type === 'refund' ? '+' : t.type === 'transfer' ? '' : '−'}{money(t.amount, t.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
