import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, Notice } from '@/components/ui/states';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { BalanceChart } from '@/components/charts/balance-chart';
import { requireContext } from '@/lib/db/queries';
import { averageFreeCashflow, liquidBalance, planDebts } from '@/lib/debts/plan-load';
import { one, type SearchParams } from '@/lib/report';
import { compareScenarios, safeExtraPayment, type PayoffPlan } from '@/lib/finance/payoff-plan';
import { CURRENCIES, isCurrency, parseAmount, type Currency, type Minor } from '@/lib/finance/money';
import { dateShort, money, toChartNumber } from '@/lib/format';

export const metadata: Metadata = { title: 'План погашения долгов' };

const AMOUNT = /^\d{1,12}(?:[.,]\d{1,2})?$/;
const amountParam = (v: string | undefined, fallback: Minor): Minor => (v && AMOUNT.test(v) ? parseAmount(v) : fallback);
const NAMES = { minimum: 'Только минимальные', avalanche: 'Лавина', snowball: 'Снежный ком' } as const;

export default async function PlanPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const owedCurrencies = CURRENCIES.filter((c) => ctx.debts.some((d) => d.status === 'active' && d.direction === 'owed_by_me' && d.currency === c));
  if (!owedCurrencies.length) {
    return (
      <div className="flex flex-col gap-6">
        <Link href="/debts" className="inline-flex items-center gap-1 text-sm text-text-secondary"><ArrowLeft className="h-4 w-4" aria-hidden /> Долги</Link>
        <EmptyState title="Нет активных долгов" description="План погашения строится по долгам, которые вы должны. Добавьте их в разделе «Долги»." />
      </div>
    );
  }

  const curParam = one(sp.cur);
  const currency: Currency = curParam && isCurrency(curParam) && owedCurrencies.includes(curParam) ? curParam : owedCurrencies[0]!;
  const strategy = one(sp.strategy) === 'snowball' ? 'snowball' : 'avalanche';
  const reserve = amountParam(one(sp.reserve), 0n);
  const delta = amountParam(one(sp.delta), 0n);

  let cashflow, liquid;
  try {
    [cashflow, liquid] = await Promise.all([averageFreeCashflow(ctx, currency), liquidBalance(ctx, currency)]);
  } catch (e) {
    return <ErrorState message={e instanceof Error ? e.message : undefined} />;
  }
  const requestedRaw = one(sp.extra);
  const safe = safeExtraPayment({ avgFreeCashflow: cashflow.value, liquidBalance: liquid, reserve, requested: amountParam(requestedRaw, 0n) });
  // Default extra = the safe suggestion; the user may override it.
  const extra = requestedRaw !== undefined && AMOUNT.test(requestedRaw) ? parseAmount(requestedRaw) : (safe.suggested ?? 0n);

  const debts = planDebts(ctx, currency);
  const c = compareScenarios(debts, { extraMonthly: extra, startDate: ctx.today, strategy, delta });
  const chosen = strategy === 'avalanche' ? c.avalanche : c.snowball;
  const m = (v: Minor) => money(v, currency);
  const yr = ctx.today.slice(0, 4);
  const lastDate = (p: PayoffPlan) => (p.complete && p.totals.months ? p.months[p.totals.months - 1]!.date : null);

  // chart: total remaining debt per month, sampled to ≤ 120 points
  const longest = Math.max(c.minimum.months.length, c.avalanche.months.length, c.snowball.months.length);
  const step = Math.max(1, Math.ceil(longest / 120));
  const at = (p: PayoffPlan, i: number) => (i === 0 ? p.totals.startBalance : i <= p.months.length ? p.months[i - 1]!.totalBalance : p.complete ? 0n : null);
  const chart = [];
  for (let i = 0; i <= longest; i += step) {
    const label = i === 0 ? 'сейчас' : (c.minimum.months[i - 1] ?? c.avalanche.months[i - 1] ?? c.snowball.months[i - 1])!.date.slice(0, 7);
    const v = (p: PayoffPlan) => { const x = at(p, i); return x === null ? null : toChartNumber(x); };
    chart.push({ label, minimum: v(c.minimum), avalanche: v(c.avalanche), snowball: v(c.snowball) });
  }
  const debtName = new Map(debts.map((d) => [d.id, d.name]));
  const assumptions = [...new Set([...chosen.assumptions])];

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <Link href="/debts" className="inline-flex items-center gap-1 text-sm text-text-secondary"><ArrowLeft className="h-4 w-4" aria-hidden /> Долги</Link>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">План погашения долгов</h1>
        <p className="text-sm text-text-secondary">Сначала всегда вносятся минимальные платежи по всем долгам; дополнительные деньги идут по выбранной стратегии, а платежи закрытых долгов переходят на следующие.</p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Параметры плана">
            {owedCurrencies.length > 1 ? (
              <label className="flex flex-col gap-1 text-xs text-text-secondary">Валюта долгов
                <Select name="cur" defaultValue={currency}>{owedCurrencies.map((x) => <option key={x}>{x}</option>)}</Select>
              </label>
            ) : <input type="hidden" name="cur" value={currency} />}
            <label className="flex flex-col gap-1 text-xs text-text-secondary">Стратегия
              <Select name="strategy" defaultValue={strategy}>
                <option value="avalanche">Лавина: сначала самая высокая ставка</option>
                <option value="snowball">Снежный ком: сначала самый маленький долг</option>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">Сверх минимальных, {currency}/мес
              <Input name="extra" inputMode="decimal" defaultValue={requestedRaw ?? (safe.suggested !== null ? String(Number(safe.suggested) / 100) : '0')} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">Минимальный резерв, {currency}
              <Input name="reserve" inputMode="decimal" defaultValue={one(sp.reserve) ?? '0'} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">«Что если» добавить ещё, {currency}/мес
              <Input name="delta" inputMode="decimal" defaultValue={one(sp.delta) ?? ''} placeholder="например 5000" />
            </label>
            <div className="flex items-end"><button type="submit" className="min-h-9 w-full rounded-lg bg-accent px-4 text-sm font-medium text-accent-contrast">Рассчитать</button></div>
          </form>
          <p className="mt-3 text-xs text-text-muted">
            Средний свободный остаток за {cashflow.months || 0} полн. мес. (доходы − расходы − погашение основного долга, только операции в {currency}): {cashflow.value === null ? 'нет данных' : m(cashflow.value)}.
            Остатки на счетах в {currency}: {m(liquid)}. Приоритетные долги (отметка в карточке долга) получают дополнительные деньги первыми.
          </p>
        </CardContent>
      </Card>

      {safe.warnings.length ? <Notice>{safe.warnings.map((w) => <p key={w}>{w}</p>)}</Notice> : null}

      <Card>
        <CardHeader><CardTitle>Сравнение сценариев при {m(extra)} сверх минимальных</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead><TR><TH>Сценарий</TH><TH className="text-right">Срок</TH><TH>Все долги закрыты</TH><TH className="text-right">Проценты</TH><TH className="text-right">Выплачено всего</TH><TH className="text-right">Экономия на процентах</TH></TR></THead>
            <TBody>
              {([c.minimum, c.avalanche, c.snowball] as const).map((p) => (
                <TR key={p.strategy} className={p.strategy === strategy ? 'bg-surface-muted' : undefined}>
                  <TD className="font-medium">{NAMES[p.strategy]} {p.strategy === strategy ? <Badge>выбрано</Badge> : null}</TD>
                  <TD className="tabular text-right">{p.complete ? `${p.totals.months} мес.` : 'не погашается'}</TD>
                  <TD>{lastDate(p) ? dateShort(lastDate(p)!, yr) : '—'}</TD>
                  <TD className="tabular text-right">{m(p.totals.interestTotal)}{p.complete ? '' : '+'}</TD>
                  <TD className="tabular text-right">{m(p.totals.paidTotal)}</TD>
                  <TD className="tabular text-right">{p.strategy === 'minimum' ? '—' : c.minimum.complete && p.complete ? m(c.minimum.totals.interestTotal - p.totals.interestTotal) : '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {!c.minimum.complete ? <p className="mt-2 text-xs text-negative">Только минимальными платежами долги не погашаются за 50 лет: проценты съедают платёж.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Остаток долга по месяцам</CardTitle></CardHeader>
        <CardContent><BalanceChart data={chart} currency={currency} /></CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{NAMES[strategy]}: порядок и даты закрытия</CardTitle></CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2 text-sm">
              {chosen.order.map((id, k) => {
                const o = chosen.debts.find((d) => d.debtId === id)!;
                return (
                  <li key={id} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>{k + 1}. {debtName.get(id)}</span>
                    <span className="tabular text-text-secondary">{o.payoffDate ? `закрыт ${dateShort(o.payoffDate, yr)}` : 'не погашается'} · проценты {m(o.interestTotal)}{o.feesTotal > 0n ? ` · комиссии ${m(o.feesTotal)}` : ''}</span>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Если платить больше</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {c.whatIf ? (
              <p>
                При {m(extra + c.whatIf.delta)} вместо {m(extra)} в месяц: срок {c.whatIf.plan.complete ? `${c.whatIf.plan.totals.months} мес.` : 'не определён'}
                {c.whatIf.monthsSaved !== null ? ` (на ${c.whatIf.monthsSaved} мес. быстрее)` : ''}, проценты меньше на {m(c.whatIf.interestSaved)}.
              </p>
            ) : <p className="text-text-muted">Укажите сумму в поле «Что если», чтобы увидеть, как изменится срок и переплата.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>График платежей ({NAMES[strategy]})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR><TH>Месяц</TH>{debts.map((d) => <TH key={d.id} className="text-right">{d.name}</TH>)}<TH className="text-right">Всего</TH><TH className="text-right">Остаток</TH></TR>
            </THead>
            <TBody>
              {chosen.months.slice(0, 120).map((mo) => (
                <TR key={mo.index}>
                  <TD className="whitespace-nowrap">{dateShort(mo.date, yr)}</TD>
                  {debts.map((d) => {
                    const l = mo.lines.find((x) => x.debtId === d.id);
                    return <TD key={d.id} className="tabular whitespace-nowrap text-right">{l ? <>{m(l.payment)}<span className="block text-[11px] text-text-muted">проц. {m(l.interest)} · ост. {m(l.balanceAfter)}</span></> : '—'}</TD>;
                  })}
                  <TD className="tabular whitespace-nowrap text-right">{m(mo.totalPayment)}</TD>
                  <TD className="tabular whitespace-nowrap text-right">{m(mo.totalBalance)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {chosen.months.length > 120 ? <p className="mt-2 text-xs text-text-muted">Показаны первые 120 месяцев из {chosen.months.length}.</p> : null}
        </CardContent>
      </Card>

      <Notice tone="info">
        <p className="font-medium">Расчёт приблизительный</p>
        <ul className="mt-1 list-disc pl-5">{assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        <p className="mt-1">Комиссии за досрочное погашение и правила банка уточняйте в договоре. Перед досрочным платежом убедитесь, что резерв и обязательные расходы покрыты.</p>
      </Notice>
    </div>
  );
}
