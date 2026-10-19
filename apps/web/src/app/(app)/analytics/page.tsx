import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, ErrorState, Notice } from '@/components/ui/states';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { FilterBar } from '@/components/filter-bar';
import { StatCard } from '@/components/stat-card';
import { CategoryBars } from '@/components/charts/category-bars';
import { IncomeExpenseChart } from '@/components/charts/income-expense-chart';
import { requireContext } from '@/lib/db/queries';
import { toMinor } from '@/lib/db/convert';
import { loadReport, one, type SearchParams } from '@/lib/report';
import { findPossibleDuplicates } from '@/lib/finance/dedupe';
import { goalProgress } from '@/lib/finance/budget';
import { type Bucket, defaultBucket, timeSeries } from '@/lib/finance/series';
import { daysInRange } from '@/lib/finance/dates';
import { ratioBp } from '@/lib/finance/money';
import { dateShort, money, pct, rangeLabel, toChartNumber } from '@/lib/format';
import type { GoalRow } from '@/lib/db/types';

export const metadata: Metadata = { title: 'Аналитика' };

const BUCKETS: [Bucket, string][] = [['day', 'По дням'], ['week', 'По неделям'], ['month', 'По месяцам']];

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await requireContext();

  let report, goals: GoalRow[];
  try {
    report = await loadReport(ctx, sp);
    const g = await ctx.supabase.from('financial_goals').select('*').eq('household_id', ctx.household.id).eq('status', 'active');
    if (g.error) throw new Error(g.error.message);
    goals = g.data as GoalRow[];
  } catch (e) {
    return <ErrorState message={e instanceof Error ? e.message : undefined} />;
  }

  const { period, view, current, comparison, forecast, unusual, categoryName } = report;
  const cur = view.currency;
  const base = ctx.household.base_currency;
  const days = daysInRange(period.from, period.to);
  const requested = one(sp.bucket);
  const bucket: Bucket = BUCKETS.some(([b]) => b === requested) ? (requested as Bucket) : defaultBucket(days);
  const series = timeSeries(report.txs, { range: period, bucket, view }).map((p) => ({
    label: bucket === 'month' ? p.start.slice(0, 7) : dateShort(p.start, ''), income: toChartNumber(p.income), expense: toChartNumber(p.expense),
  }));

  const duplicates = findPossibleDuplicates(report.txs.filter((t) => t.occurredOn >= period.from && t.occurredOn <= period.to));
  const debtLoad = ratioBp(current.debtPrincipalPaid + current.interestAndFeesPaid, current.income);
  const monthlyNet = current.hasData && current.elapsedDays >= 14 ? (current.net * 30n) / BigInt(current.elapsedDays) : null;
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) { const x = one(v); if (x) p.set(k, x); }
    for (const [k, v] of Object.entries(patch)) p.set(k, v);
    return `?${p.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Аналитика</h1>
        <p className="text-sm text-text-secondary">{rangeLabel(period.from, period.to)} · {view.mode === 'base' ? `все валюты в ${cur}` : `только ${cur}`}{current.provisional ? ' · предварительно' : ''}</p>
      </div>
      <FilterBar period={period.key} from={period.from} to={period.to} cur={one(sp.cur) ?? 'base'} user={report.userId ?? ''} baseCurrency={base} members={ctx.members} />

      {!current.hasData ? (
        <EmptyState title="В этом периоде нет операций" description="Выберите другой период или добавьте операции — графики строятся только по реальным данным." />
      ) : (
        <>
          {current.unconverted.count > 0 ? <Notice>{current.unconverted.count} операц. без курса не вошли в суммы. Добавьте курс в настройках или смотрите валюты по отдельности.</Notice> : null}

          <section aria-label="Показатели" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Средние расходы в день" value={current.avgDailyExpense !== null ? money(current.avgDailyExpense, cur) : '—'} hint={`за ${current.elapsedDays} дн.`} />
            <StatCard label="Прогноз расходов на месяц" value={forecast ? money(forecast.projectedExpense, cur) : '—'}
              hint={forecast ? `по темпу ${forecast.basedOnDays} дн., приблизительно` : period.key !== 'month' ? 'только для периода «Месяц»' : 'мало данных (нужно ≥ 7 дней)'} />
            <StatCard label="Доля сбережений" value={pct(current.savingsRateBp)} hint="от доходов периода" />
            <StatCard label="На долги от доходов" value={pct(debtLoad)} hint={`основной долг ${money(current.debtPrincipalPaid, cur)} + проценты и комиссии ${money(current.interestAndFeesPaid, cur)}`} />
          </section>

          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>Динамика доходов и расходов</CardTitle>
              <nav aria-label="Группировка" className="flex gap-1 text-xs">
                {BUCKETS.map(([b, l]) => (
                  <Link key={b} href={qs({ bucket: b })} aria-current={b === bucket ? 'true' : undefined} className={`rounded-md px-2 py-1 ${b === bucket ? 'bg-surface-muted font-medium' : 'text-text-secondary hover:bg-surface-muted'}`}>{l}</Link>
                ))}
              </nav>
            </CardHeader>
            <CardContent><IncomeExpenseChart data={series} currency={cur} /></CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Расходы по категориям</CardTitle></CardHeader>
              <CardContent><CategoryBars currency={cur} items={current.byCategory.map((c) => ({ id: c.categoryId, name: categoryName(c.categoryId), amount: c.expense, shareBp: c.shareBp }))} /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Постоянные и переменные расходы</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {current.expense > 0n ? (
                  <>
                    <div className="flex h-3 overflow-hidden rounded-full bg-surface-muted" role="img" aria-label={`Постоянные ${pct(ratioBp(current.fixedExpense, current.expense))}, переменные ${pct(ratioBp(current.variableExpense, current.expense))}`}>
                      <div style={{ width: `${Math.max(0, (ratioBp(current.fixedExpense, current.expense) ?? 0) / 100)}%`, background: 'var(--series-1)' }} />
                      <div className="ml-0.5 flex-1" style={{ background: 'var(--series-2)' }} />
                    </div>
                    <p className="tabular flex justify-between"><span><span aria-hidden style={{ color: 'var(--series-1)' }}>■</span> Постоянные</span><span>{money(current.fixedExpense, cur)} · {pct(ratioBp(current.fixedExpense, current.expense))}</span></p>
                    <p className="tabular flex justify-between"><span><span aria-hidden style={{ color: 'var(--series-2)' }}>■</span> Переменные</span><span>{money(current.variableExpense, cur)} · {pct(ratioBp(current.variableExpense, current.expense))}</span></p>
                    <p className="text-xs text-text-muted">Постоянными считаются категории с пометкой «постоянный расход» (жильё, кредиты, подписки, налоги и свои).</p>
                  </>
                ) : <p className="text-text-muted">Расходов в периоде нет.</p>}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Сравнение с предыдущим периодом</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!comparison.comparable ? (
                <p className="text-sm text-text-secondary">Сравнение невозможно: {{
                  no_previous_data: `за ${rangeLabel(report.prevRange.from, report.prevRange.to)} нет операций`,
                  no_current_data: 'в выбранном периоде нет операций',
                  different_length: 'периоды разной длины',
                  different_currency: 'разные валюты',
                }[comparison.reason]}.</p>
              ) : (
                <>
                  <p className="text-xs text-text-muted">{rangeLabel(period.from, period.to)} к {rangeLabel(report.prevRange.from, report.prevRange.to)}{comparison.provisional ? ' · текущий период не завершён' : ''}</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {([['Доходы', comparison.income], ['Расходы', comparison.expense], ['Разница', comparison.net]] as const).map(([label, d]) => (
                      <div key={label} className="rounded-lg border border-border p-3 text-sm">
                        <p className="text-xs text-text-muted">{label}</p>
                        <p className="tabular font-medium">{money(d.current, cur)}</p>
                        <p className="tabular text-xs text-text-secondary">было {money(d.previous, cur)} · {pct(d.changeBp, { signed: true })}</p>
                      </div>
                    ))}
                  </div>
                  <Table>
                    <THead><TR><TH>Категория</TH><TH className="text-right">Сейчас</TH><TH className="text-right">Было</TH><TH className="text-right">Изменение</TH></TR></THead>
                    <TBody>
                      {comparison.categories.filter((c) => c.diff !== 0n).slice(0, 12).map((c) => (
                        <TR key={c.categoryId ?? 'none'}>
                          <TD>{categoryName(c.categoryId)} {c.isNew ? <Badge>новая</Badge> : c.disappeared ? <Badge>не было трат</Badge> : null}</TD>
                          <TD className="tabular text-right">{money(c.current, cur)}</TD>
                          <TD className="tabular text-right text-text-secondary">{money(c.previous, cur)}</TD>
                          <TD className={`tabular text-right ${c.diff > 0n ? 'text-negative' : 'text-positive'}`}>{c.diff > 0n ? '↑' : '↓'} {money(c.diff < 0n ? -c.diff : c.diff, cur)} {c.changeBp !== null ? `(${pct(c.changeBp, { signed: true })})` : ''}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Необычные расходы</CardTitle></CardHeader>
              <CardContent>
                {unusual.length === 0 ? (
                  <p className="text-sm text-text-muted">Необычно крупных трат не найдено. Проверка требует ≥ 5 прошлых расходов в категории и сравнивает с их медианой (порог — втрое выше).</p>
                ) : (
                  <ul className="divide-y divide-border text-sm">
                    {unusual.slice(0, 8).map((u) => (
                      <li key={u.id} className="py-2">
                        <p className="tabular flex justify-between gap-3"><span>{categoryName(u.categoryId)} · {dateShort(u.occurredOn, '')}</span><span className="font-medium">{money(u.amount, cur)}</span></p>
                        <p className="text-xs text-text-muted">обычно в этой категории ≈ {money(u.median, cur)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Возможные дубликаты</CardTitle></CardHeader>
              <CardContent>
                {duplicates.length === 0 ? <p className="text-sm text-text-muted">Похожих операций (одинаковые сумма, счёт и тип в пределах суток) не найдено.</p> : (
                  <ul className="divide-y divide-border text-sm">
                    {duplicates.slice(0, 6).map((g, i) => (
                      <li key={i} className="py-2">
                        <p className="tabular">{money(g[0]!.amount, g[0]!.currency)} · {g.map((t) => dateShort(t.occurredOn, '')).join(', ')}</p>
                        <p className="text-xs text-text-muted">{g.length} похожих операции — проверьте в <Link className="underline" href="/transactions">списке операций</Link>.</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Достижение финансовых целей</CardTitle></CardHeader>
            <CardContent>
              {goals.length === 0 ? <p className="text-sm text-text-muted">Активных целей нет. Создайте их в разделе «Бюджеты».</p> : (
                <ul className="flex flex-col gap-3 text-sm">
                  {goals.map((g) => {
                    const p = goalProgress({ target: toMinor(g.target_amount), current: toMinor(g.current_amount), targetDate: g.target_date, today: ctx.today });
                    const sameCcy = g.currency === base;
                    const onTrack = p.requiredPerMonth !== null && monthlyNet !== null && sameCcy ? monthlyNet >= p.requiredPerMonth : null;
                    return (
                      <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-2">
                        <span>{g.name} <span className="text-text-muted">· {pct(p.progressBp)}</span></span>
                        <span className="text-xs text-text-secondary">
                          {p.requiredPerMonth !== null ? `нужно ≈ ${money(p.requiredPerMonth, g.currency)}/мес` : 'без срока'}
                          {onTrack === null ? '' : onTrack ? ' · текущий темп достаточен' : ` · текущий темп ≈ ${money(monthlyNet! < 0n ? 0n : monthlyNet!, base)}/мес`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-3 text-xs text-text-muted">Темп — чистый денежный поток периода в пересчёте на 30 дней (приблизительно; нужен период ≥ 14 дней и цель в валюте отчётов).</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
