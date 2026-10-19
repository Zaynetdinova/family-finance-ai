import type { Metadata } from 'next';
import { Plus, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { StatCard } from '@/components/stat-card';
import { DebtFormDialog, DebtRowActions, type DebtInitial } from '@/components/debts/debt-form';
import { TransactionFormDialog } from '@/components/transactions/transaction-form';
import { requireContext } from '@/lib/db/queries';
import { debtSchedule, toMinor, toMinorOrNull } from '@/lib/db/convert';
import { categoryNamer, loadDebtPayments } from '@/lib/report';
import { estimatePayoff, percentToPpm, repaidBp, upcomingPayments } from '@/lib/finance/debts';
import { addDays } from '@/lib/finance/dates';
import { CURRENCIES, type Currency } from '@/lib/finance/money';
import { dateShort, money, pct } from '@/lib/format';
import type { DebtRow } from '@/lib/db/types';

export const metadata: Metadata = { title: 'Долги' };

const KIND: Record<string, string> = { loan: 'Кредит', mortgage: 'Ипотека', credit_card: 'Кредитная карта', personal: 'Долг человеку', other: 'Другое' };

function initialOf(d: DebtRow): DebtInitial {
  return {
    id: d.id, name: d.name, direction: d.direction, kind: d.kind, currency: d.currency,
    originalAmount: String(d.original_amount), currentBalance: String(d.current_balance),
    interestRate: d.interest_rate === null ? '' : String(d.interest_rate), rateType: d.rate_type,
    minPayment: d.min_payment === null ? '' : String(d.min_payment), paymentDay: d.payment_day === null ? '' : String(d.payment_day),
    openedOn: d.opened_on ?? '', dueDate: d.due_date ?? '', counterparty: d.counterparty ?? '',
    allowsPrepayment: d.allows_prepayment, priority: d.priority, notes: d.notes ?? '',
  };
}

export default async function DebtsPage() {
  const ctx = await requireContext();
  let payments;
  try {
    payments = await loadDebtPayments(ctx, addDays(ctx.today, -365));
  } catch (e) {
    return <ErrorState message={e instanceof Error ? e.message : undefined} />;
  }
  const canWrite = ['owner', 'admin', 'member'].includes(ctx.role);
  const catName = categoryNamer(ctx);
  const upcoming = upcomingPayments(ctx.debts.map(debtSchedule), payments.map((p) => ({ debtId: p.debt_id, paidOn: p.paid_on })), ctx.today, 45);

  const active = ctx.debts.filter((d) => d.status === 'active');
  const sumBy = (dir: DebtRow['direction']) => {
    const m = new Map<Currency, bigint>();
    for (const d of active.filter((x) => x.direction === dir)) m.set(d.currency, (m.get(d.currency) ?? 0n) + toMinor(d.current_balance));
    return CURRENCIES.filter((c) => m.has(c)).map((c) => money(m.get(c)!, c)).join(' · ') || '—';
  };
  const interestPaid = new Map<Currency, bigint>();
  const debtCcy = new Map(ctx.debts.map((d) => [d.id, d.currency] as const));
  for (const p of payments) {
    const c = debtCcy.get(p.debt_id);
    if (c) interestPaid.set(c, (interestPaid.get(c) ?? 0n) + toMinor(p.interest) + toMinor(p.fees));
  }
  const interestText = CURRENCIES.filter((c) => interestPaid.has(c)).map((c) => money(interestPaid.get(c)!, c)).join(' · ') || '—';

  const addButton = <Button><Plus className="h-4 w-4" aria-hidden /> Добавить долг</Button>;
  const formAccounts = ctx.accounts.filter((a) => !a.is_archived).map((a) => ({ id: a.id, name: a.name, currency: a.currency }));
  const formCategories = ctx.categories.map((c) => ({ id: c.id, name: catName(c.id), kind: c.kind }));
  const formDebts = active.filter((d) => d.direction === 'owed_by_me').map((d) => ({ id: d.id, name: d.name, currency: d.currency }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Долги</h1>
          <p className="text-sm text-text-secondary">Кредиты, ипотека и личные обязательства</p>
        </div>
        {canWrite ? <DebtFormDialog trigger={addButton} /> : null}
      </div>

      {ctx.debts.length === 0 ? (
        <EmptyState icon={<Wallet className="h-8 w-8" aria-hidden />} title="Долгов пока нет" description="Добавьте кредит или ипотеку, чтобы видеть прогресс погашения, ближайшие платежи и оценку даты закрытия." action={canWrite ? <DebtFormDialog trigger={addButton} /> : undefined} />
      ) : (
        <>
          <section aria-label="Итоги" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Я должен" value={sumBy('owed_by_me')} hint="остаток основного долга" />
            <StatCard label="Мне должны" value={sumBy('owed_to_me')} />
            <StatCard label="Проценты и комиссии за год" value={interestText} hint="по записанным платежам" />
            <StatCard label="Ближайший платёж" value={upcoming[0] ? money(upcoming[0].amount, upcoming[0].currency) : '—'} hint={upcoming[0] ? `${upcoming[0].name}, ${dateShort(upcoming[0].date, '')}${upcoming[0].overdue ? ' · просрочен' : ''}` : 'нет запланированных'} />
          </section>

          <ul className="flex flex-col gap-4" aria-label="Список долгов">
            {ctx.debts.map((d) => {
              const balance = toMinor(d.current_balance);
              const original = toMinor(d.original_amount);
              const progress = repaidBp(original, balance);
              const mine = d.direction === 'owed_by_me';
              const est = mine && d.status === 'active'
                ? estimatePayoff({ balance, annualRatePpm: d.interest_rate === null ? null : percentToPpm(String(d.interest_rate)), monthlyPayment: toMinorOrNull(d.min_payment), from: ctx.today })
                : null;
              const next = upcoming.find((u) => u.debtId === d.id);
              const history = payments.filter((p) => p.debt_id === d.id).slice(0, 4);
              return (
                <li key={d.id}>
                  <Card>
                    <CardContent className="flex flex-col gap-4 pt-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h2 className="text-base font-semibold">{d.name}</h2>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <Badge>{KIND[d.kind]}</Badge>
                            <Badge>{mine ? 'я должен' : 'мне должны'}</Badge>
                            {d.status === 'closed' ? <Badge tone="positive">закрыт</Badge> : null}
                            {d.priority ? <Badge tone="warning">приоритет</Badge> : null}
                            {d.interest_rate !== null ? <Badge>{String(d.interest_rate)}% {d.rate_type === 'variable' ? 'плавающая' : 'годовых'}</Badge> : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {canWrite && mine && d.status === 'active' ? (
                            <TransactionFormDialog
                              trigger={<Button variant="outline" size="sm">Записать платёж</Button>}
                              accounts={formAccounts} categories={formCategories} debts={formDebts} today={ctx.today}
                              preset={{ type: 'debt_payment', debtId: d.id }}
                            />
                          ) : null}
                          {canWrite ? <DebtRowActions initial={initialOf(d)} canDelete={ctx.role === 'owner' || ctx.role === 'admin'} /> : null}
                        </div>
                      </div>

                      <div>
                        <div className="mb-1.5 flex items-baseline justify-between text-sm">
                          <span className="tabular font-medium">{money(balance, d.currency)} <span className="font-normal text-text-muted">из {money(original, d.currency)}</span></span>
                          <span className="tabular text-text-secondary">погашено {pct(progress)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-surface-muted" role="progressbar" aria-label="Прогресс погашения" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) / 100)}>
                          <div className="h-2 rounded-full" style={{ width: `${Math.min(100, (progress ?? 0) / 100)}%`, background: 'var(--series-3)' }} />
                        </div>
                      </div>

                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                        <div><dt className="text-xs text-text-muted">Минимальный платёж</dt><dd className="tabular">{d.min_payment === null ? '—' : money(toMinor(d.min_payment), d.currency)}</dd></div>
                        <div><dt className="text-xs text-text-muted">Следующий платёж</dt><dd>{next ? `${dateShort(next.date, '')}${next.overdue ? ' (просрочен)' : ''}` : d.payment_day ? `${d.payment_day}-го числа` : '—'}</dd></div>
                        <div><dt className="text-xs text-text-muted">Срок погашения</dt><dd>{d.due_date ? dateShort(d.due_date, ctx.today.slice(0, 4)) : '—'}</dd></div>
                        <div>
                          <dt className="text-xs text-text-muted">Прогноз закрытия</dt>
                          <dd>
                            {!est ? '—'
                              : est.status === 'ok' ? <>≈ {dateShort(est.closeDate, ctx.today.slice(0, 4))} <span className="text-text-muted">({est.months} мес., приблизительно)</span></>
                              : est.status === 'never' ? <span className="text-negative">платёж не покрывает проценты (≈ {money(est.monthlyInterest, d.currency)}/мес)</span>
                              : <span className="text-text-muted">укажите {est.missing.map((m) => (m === 'payment' ? 'минимальный платёж' : 'ставку')).join(' и ')}</span>}
                          </dd>
                        </div>
                      </dl>
                      {est?.status === 'ok' ? <p className="text-xs text-text-muted">Оценка процентов до закрытия при текущем платеже: ≈ {money(est.totalInterest, d.currency)}. Расчёт упрощённый: без комиссий и изменения ставки.</p> : null}

                      {history.length ? (
                        <div>
                          <h3 className="mb-1 text-xs font-medium text-text-muted">Последние платежи</h3>
                          <ul className="divide-y divide-border text-sm">
                            {history.map((p) => (
                              <li key={p.id} className="tabular flex flex-wrap justify-between gap-x-4 py-1.5">
                                <span className="text-text-secondary">{dateShort(p.paid_on, ctx.today.slice(0, 4))}</span>
                                <span>основной долг {money(toMinor(p.principal), d.currency)} · проценты {money(toMinor(p.interest), d.currency)}{toMinor(p.fees) > 0n ? ` · комиссии ${money(toMinor(p.fees), d.currency)}` : ''}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
