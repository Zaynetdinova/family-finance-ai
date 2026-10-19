'use server';
import { revalidatePath } from 'next/cache';
import { requireContext, loadRecentRates } from '@/lib/db/queries';
import { rateRow, toMinor, toRate } from '@/lib/db/convert';
import { buildTransaction } from '@/lib/transactions/build';
import { transactionInputSchema } from '@/lib/transactions/schema';
import type { TransactionRow } from '@/lib/db/types';
import { dbError, fieldErrors, formObject, type ActionResult } from './result';

const WRITE_ROLES = ['owner', 'admin', 'member'];

function forbidden(role: string): ActionResult | null {
  return WRITE_ROLES.includes(role) ? null : { ok: false, error: 'У вас права только на просмотр.' };
}

/** Create (id = null) or update a transaction. Currency, FX snapshot and debt split are computed on the server. */
export async function saveTransaction(id: string | null, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  const denied = forbidden(ctx.role);
  if (denied) return denied;

  const parsed = transactionInputSchema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };

  let existing;
  if (id) {
    const { data } = await ctx.supabase.from('transactions').select('*').eq('id', id).eq('household_id', ctx.household.id).maybeSingle();
    const row = data as TransactionRow | null;
    if (!row) return { ok: false, error: 'Операция не найдена.' };
    existing = {
      amount: toMinor(row.amount),
      currency: row.currency,
      occurredOn: row.occurred_on,
      fx: row.base_currency && row.fx_rate !== null && row.fx_rate_date && row.base_amount !== null
        ? { baseCurrency: row.base_currency, rate: toRate(row.fx_rate), rateDate: row.fx_rate_date, source: row.fx_rate_source ?? 'stored', baseAmount: toMinor(row.base_amount) }
        : null,
    };
  }

  const built = buildTransaction(parsed.data, {
    householdId: ctx.household.id,
    userId: ctx.userId,
    baseCurrency: ctx.household.base_currency,
    accounts: ctx.accounts.map((a) => ({ id: a.id, currency: a.currency })),
    debts: ctx.debts.map((d) => ({ id: d.id, currency: d.currency })),
    rates: (await loadRecentRates(ctx, 30)).map(rateRow),
    existing,
  });
  if (!built.ok) return { ok: false, fieldErrors: built.fieldErrors };

  const res = id
    ? await ctx.supabase.from('transactions').update(built.row).eq('id', id).eq('household_id', ctx.household.id)
    : await ctx.supabase.from('transactions').insert({ ...built.row, created_by: ctx.userId, source: 'web' });
  if (res.error) return { ok: false, error: dbError(res.error.message) };

  revalidatePath('/', 'layout');
  return { ok: true, message: built.warnings[0] ?? (id ? 'Операция обновлена' : 'Операция добавлена') };
}

/** Hard delete. The UI asks for confirmation before calling this. */
export async function deleteTransaction(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const denied = forbidden(ctx.role);
  if (denied) return denied;
  const { error, count } = await ctx.supabase
    .from('transactions')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('household_id', ctx.household.id);
  if (error) return { ok: false, error: dbError(error.message) };
  if (!count) return { ok: false, error: 'Операция не найдена или нет прав на удаление.' };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Операция удалена' };
}

export async function confirmTransaction(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  const denied = forbidden(ctx.role);
  if (denied) return denied;
  const { error, count } = await ctx.supabase
    .from('transactions')
    .update({ status: 'confirmed' }, { count: 'exact' })
    .eq('id', id)
    .eq('household_id', ctx.household.id)
    .in('status', ['draft', 'pending_confirmation']);
  if (error) return { ok: false, error: dbError(error.message) };
  if (!count) return { ok: false, error: 'Операция уже подтверждена или не найдена.' };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Операция подтверждена' };
}
