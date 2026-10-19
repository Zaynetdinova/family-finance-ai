import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowDownUp, Download, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ImportDialog } from '@/components/transactions/import-dialog';
import { RowActions } from '@/components/transactions/row-actions';
import { TransactionFormDialog, type TransactionInitial } from '@/components/transactions/transaction-form';
import { TxFilters } from '@/components/transactions/tx-filters';
import { requireContext } from '@/lib/db/queries';
import { toMinor } from '@/lib/db/convert';
import type { TransactionRow } from '@/lib/db/types';
import { categoryNamer, type SearchParams } from '@/lib/report';
import { PAGE_SIZE, parseTxFilters, searchTerm } from '@/lib/transactions/filters';
import { dateShort, money } from '@/lib/format';
import { SOURCE_LABELS, STATUS_LABELS, TYPE_LABELS } from '@/lib/labels';

export const metadata: Metadata = { title: 'Операции' };

const sign = (t: TransactionRow['type']) => (t === 'income' || t === 'refund' ? '+' : t === 'transfer' ? '' : '−');

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const f = parseTxFilters(sp);
  const canWrite = ['owner', 'admin', 'member'].includes(ctx.role);

  let q = ctx.supabase.from('transactions').select('*', { count: 'exact' }).eq('household_id', ctx.household.id);
  if (f.type) q = q.eq('type', f.type);
  if (f.status) q = q.eq('status', f.status);
  if (f.categoryId) q = q.eq('category_id', f.categoryId);
  if (f.accountId) q = q.or(`account_id.eq.${f.accountId},transfer_account_id.eq.${f.accountId}`);
  if (f.currency) q = q.eq('currency', f.currency);
  if (f.from) q = q.gte('occurred_on', f.from);
  if (f.to) q = q.lte('occurred_on', f.to);
  const term = searchTerm(f.q);
  if (term) q = q.or(`counterparty.ilike.%${term}%,comment.ilike.%${term}%`);
  const asc = f.dir === 'asc';
  q = f.sort === 'amount'
    ? q.order('base_amount', { ascending: asc, nullsFirst: false }).order('amount', { ascending: asc })
    : q.order('occurred_on', { ascending: asc }).order('created_at', { ascending: asc });
  const offset = (f.page - 1) * PAGE_SIZE;
  const { data, count, error } = await q.range(offset, offset + PAGE_SIZE - 1);
  if (error) return <ErrorState message={error.message} />;

  const rows = (data ?? []) as TransactionRow[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const catName = categoryNamer(ctx);
  const accName = new Map(ctx.accounts.map((a) => [a.id, a.name]));
  const accounts = ctx.accounts.filter((a) => !a.is_archived).map((a) => ({ id: a.id, name: a.name, currency: a.currency }));
  const categories = ctx.categories.map((c) => ({ id: c.id, name: catName(c.id), kind: c.kind }));
  const debts = ctx.debts.filter((d) => d.status === 'active' && d.direction === 'owed_by_me').map((d) => ({ id: d.id, name: d.name, currency: d.currency }));
  const filtered = Boolean(f.q || f.type || f.categoryId || f.accountId || f.currency || f.status || f.from || f.to);

  const link = (patch: Record<string, string | number>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) { const x = Array.isArray(v) ? v[0] : v; if (x) p.set(k, x); }
    for (const [k, v] of Object.entries(patch)) p.set(k, String(v));
    return `/transactions?${p.toString()}`;
  };
  const sortLink = (field: 'date' | 'amount') => link({ sort: field, dir: f.sort === field && f.dir === 'desc' ? 'asc' : 'desc', page: 1 });
  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) { const x = Array.isArray(v) ? v[0] : v; if (x && k !== 'page') exportParams.set(k, x); }

  const initialOf = (r: TransactionRow): TransactionInitial => ({
    id: r.id, type: r.type, amount: String(r.amount), accountId: r.account_id, occurredOn: r.occurred_on, categoryId: r.category_id ?? '',
    counterparty: r.counterparty ?? '', comment: r.comment ?? '', transferAccountId: r.transfer_account_id ?? '',
    transferAmount: r.transfer_amount === null ? '' : String(r.transfer_amount), debtId: r.debt_id ?? '',
    interest: r.interest_amount === null ? '' : String(r.interest_amount), fee: r.fee_amount === null ? '' : String(r.fee_amount),
  });

  const title = (r: TransactionRow) =>
    r.counterparty || (r.type === 'transfer' ? `Перевод: ${accName.get(r.account_id)} → ${accName.get(r.transfer_account_id ?? '') ?? '?'}` : r.category_id ? catName(r.category_id) : TYPE_LABELS[r.type]);

  const convertedHint = (r: TransactionRow) =>
    r.base_currency && r.base_currency !== r.currency && r.base_amount !== null
      ? `≈ ${money(toMinor(r.base_amount), r.base_currency)} по курсу ${r.fx_rate} от ${r.fx_rate_date}`
      : r.currency !== ctx.household.base_currency && r.base_amount === null ? 'курс не зафиксирован' : null;

  const addButton = (
    <TransactionFormDialog
      trigger={<Button><Plus className="h-4 w-4" aria-hidden /> Добавить</Button>}
      {...{ accounts, categories, debts }} today={ctx.today}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Операции</h1>
          <p className="text-sm text-text-secondary">{total} {filtered ? 'найдено' : 'всего'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ImportDialog />
          <Button variant="outline" asChild>
            <a href={`/api/transactions/export?${exportParams.toString()}`} download><Download className="h-4 w-4" aria-hidden /> Экспорт CSV</a>
          </Button>
          {canWrite ? addButton : null}
        </div>
      </div>

      <TxFilters
        values={{ q: f.q, type: f.type, category: f.categoryId, account: f.accountId, currency: f.currency, status: f.status, from: f.from, to: f.to }}
        categories={categories.map(({ id, name }) => ({ id, name }))}
        accounts={accounts.map(({ id, name }) => ({ id, name }))}
      />

      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? 'Ничего не найдено' : 'Операций пока нет'}
          description={filtered ? 'Измените или сбросьте фильтры.' : 'Добавьте первую операцию, загрузите CSV или отправьте сообщение боту в Telegram.'}
          action={!filtered && canWrite ? addButton : undefined}
        />
      ) : (
        <>
          {/* Cards on phones */}
          <ul className="flex flex-col gap-2 md:hidden" aria-label="Список операций">
            {rows.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-col gap-2 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{title(r)}</p>
                      <p className="text-xs text-text-muted">{dateShort(r.occurred_on, ctx.today.slice(0, 4))} · {accName.get(r.account_id)}</p>
                    </div>
                    <div className="text-right">
                      <p className={`tabular text-sm font-medium ${r.type === 'income' || r.type === 'refund' ? 'text-positive' : ''}`}>{sign(r.type)}{money(toMinor(r.amount), r.currency)}</p>
                      {convertedHint(r) ? <p className="text-[11px] text-text-muted">{convertedHint(r)}</p> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge>{TYPE_LABELS[r.type]}</Badge>
                      {r.status !== 'confirmed' ? <Badge tone="warning">{STATUS_LABELS[r.status]}</Badge> : null}
                      <Badge>{SOURCE_LABELS[r.source]}</Badge>
                    </div>
                    <RowActions id={r.id} label={title(r)} pending={r.status === 'pending_confirmation' || r.status === 'draft'} canWrite={canWrite} initial={initialOf(r)} {...{ accounts, categories, debts }} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>

          {/* Table from md up */}
          <Card className="hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH><Link href={sortLink('date')} className="inline-flex items-center gap-1">Дата <ArrowDownUp className="h-3 w-3" aria-hidden />{f.sort === 'date' ? <span className="sr-only">{f.dir === 'asc' ? 'по возрастанию' : 'по убыванию'}</span> : null}</Link></TH>
                  <TH>Описание</TH><TH>Счёт</TH><TH>Тип</TH><TH>Источник</TH>
                  <TH className="text-right"><Link href={sortLink('amount')} className="inline-flex items-center gap-1">Сумма <ArrowDownUp className="h-3 w-3" aria-hidden />{f.sort === 'amount' ? <span className="sr-only">{f.dir === 'asc' ? 'по возрастанию' : 'по убыванию'}</span> : null}</Link></TH>
                  <TH><span className="sr-only">Действия</span></TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap text-text-secondary">{dateShort(r.occurred_on, ctx.today.slice(0, 4))}</TD>
                    <TD className="max-w-xs">
                      <p className="truncate font-medium">{title(r)}</p>
                      <p className="truncate text-xs text-text-muted">{[r.category_id && r.counterparty ? catName(r.category_id) : null, r.comment].filter(Boolean).join(' · ')}</p>
                    </TD>
                    <TD className="whitespace-nowrap text-text-secondary">{accName.get(r.account_id)}</TD>
                    <TD><div className="flex flex-wrap gap-1"><Badge>{TYPE_LABELS[r.type]}</Badge>{r.status !== 'confirmed' ? <Badge tone="warning">{STATUS_LABELS[r.status]}</Badge> : null}</div></TD>
                    <TD className="text-text-secondary">{SOURCE_LABELS[r.source]}</TD>
                    <TD className="whitespace-nowrap text-right">
                      <p className={`tabular font-medium ${r.type === 'income' || r.type === 'refund' ? 'text-positive' : ''}`}>{sign(r.type)}{money(toMinor(r.amount), r.currency)}</p>
                      {convertedHint(r) ? <p className="text-[11px] text-text-muted">{convertedHint(r)}</p> : null}
                    </TD>
                    <TD><RowActions id={r.id} label={title(r)} pending={r.status === 'pending_confirmation' || r.status === 'draft'} canWrite={canWrite} initial={initialOf(r)} {...{ accounts, categories, debts }} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>

          <nav aria-label="Страницы" className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Страница {Math.min(f.page, pages)} из {pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild aria-disabled={f.page <= 1}>
                {f.page <= 1 ? <span className="pointer-events-none opacity-50">Назад</span> : <Link href={link({ page: f.page - 1 })}>Назад</Link>}
              </Button>
              <Button variant="outline" size="sm" asChild aria-disabled={f.page >= pages}>
                {f.page >= pages ? <span className="pointer-events-none opacity-50">Вперёд</span> : <Link href={link({ page: f.page + 1 })}>Вперёд</Link>}
              </Button>
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
