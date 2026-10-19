'use server';
import { revalidatePath } from 'next/cache';
import { requireContext } from '@/lib/db/queries';
import { amountToString, parseAmount } from '@/lib/finance/money';
import { debtInputSchema } from '@/lib/debts/schema';
import { dbError, fieldErrors, formObject, type ActionResult } from './result';

const canWrite = (role: string) => ['owner', 'admin', 'member'].includes(role);
const rate = (s?: string) => (s ? s.replace(',', '.') : null);

export async function saveDebt(id: string | null, _p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!canWrite(ctx.role)) return { ok: false, error: 'У вас права только на просмотр.' };
  const parsed = debtInputSchema.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;

  const row = {
    household_id: ctx.household.id,
    name: v.name,
    direction: v.direction,
    kind: v.kind,
    currency: v.currency,
    original_amount: amountToString(parseAmount(v.originalAmount)),
    current_balance: amountToString(parseAmount(v.currentBalance)),
    interest_rate: rate(v.interestRate),
    rate_type: v.rateType,
    min_payment: v.minPayment ? amountToString(parseAmount(v.minPayment)) : null,
    payment_day: v.paymentDay ?? null,
    opened_on: v.openedOn ?? null,
    due_date: v.dueDate ?? null,
    counterparty: v.counterparty ?? null,
    allows_prepayment: v.allowsPrepayment === 'on',
    priority: v.priority === 'on',
    notes: v.notes ?? null,
    status: parseAmount(v.currentBalance) === 0n ? 'closed' : 'active',
  };
  const res = id
    ? await ctx.supabase.from('debts').update(row).eq('id', id).eq('household_id', ctx.household.id)
    : await ctx.supabase.from('debts').insert(row);
  if (res.error) return { ok: false, error: dbError(res.error.message) };
  revalidatePath('/', 'layout');
  return { ok: true, message: id ? 'Долг обновлён' : 'Долг добавлен' };
}

export async function deleteDebt(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (ctx.role !== 'owner' && ctx.role !== 'admin') return { ok: false, error: 'Удалять долги могут администраторы.' };
  const { error, count } = await ctx.supabase.from('debts').delete({ count: 'exact' }).eq('id', id).eq('household_id', ctx.household.id);
  if (error) {
    return { ok: false, error: /foreign key/i.test(error.message) ? 'У долга есть платежи. Сначала удалите связанные операции или закройте долг.' : dbError(error.message) };
  }
  if (!count) return { ok: false, error: 'Долг не найден.' };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Долг удалён' };
}
