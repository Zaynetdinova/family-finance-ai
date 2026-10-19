import { NextResponse, type NextRequest } from 'next/server';
import { getAppContext, fetchAll } from '@/lib/db/queries';
import { parseTxFilters, searchTerm } from '@/lib/transactions/filters';
import { EXPORT_HEADER, toCsv } from '@/lib/transactions/csv';
import type { TransactionRow } from '@/lib/db/types';
import { categoryNamer } from '@/lib/report';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ctx = await getAppContext({ allowNoHousehold: true });
  if (!ctx) return NextResponse.json({ error: 'no household' }, { status: 404 });
  const f = parseTxFilters(Object.fromEntries(request.nextUrl.searchParams));

  const rows = await fetchAll<TransactionRow>((a, b) => {
    let q = ctx.supabase.from('transactions').select('*').eq('household_id', ctx.household.id);
    if (f.type) q = q.eq('type', f.type);
    if (f.status) q = q.eq('status', f.status);
    if (f.categoryId) q = q.eq('category_id', f.categoryId);
    if (f.accountId) q = q.eq('account_id', f.accountId);
    if (f.currency) q = q.eq('currency', f.currency);
    if (f.from) q = q.gte('occurred_on', f.from);
    if (f.to) q = q.lte('occurred_on', f.to);
    const term = searchTerm(f.q);
    if (term) q = q.or(`counterparty.ilike.%${term}%,comment.ilike.%${term}%`);
    return q.order('occurred_on', { ascending: false }).order('id').range(a, b);
  });

  const acc = new Map(ctx.accounts.map((a) => [a.id, a.name]));
  const catName = categoryNamer(ctx);
  const csv = toCsv(
    EXPORT_HEADER,
    rows.map((r) => [
      r.occurred_on, r.type, String(r.amount), r.currency, acc.get(r.account_id) ?? '', r.transfer_account_id ? (acc.get(r.transfer_account_id) ?? '') : '',
      r.category_id ? catName(r.category_id) : '', r.counterparty ?? '', r.comment ?? '', r.status, r.source,
      r.base_currency ?? '', r.base_amount === null ? '' : String(r.base_amount), r.fx_rate === null ? '' : String(r.fx_rate), r.fx_rate_date ?? '',
    ]),
  );
  return new NextResponse('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="transactions-${ctx.today}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
