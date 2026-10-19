'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireContext, type AppContext } from '@/lib/db/queries';
import { toMinor } from '@/lib/db/convert';
import { amountToString, CURRENCIES, parseAmount } from '@/lib/finance/money';
import { isIsoDate } from '@/lib/finance/dates';
import { dbError, fieldErrors, formObject, type ActionResult } from './result';

const WRITE = ['owner', 'admin', 'member'];
const NO_WRITE: ActionResult = { ok: false, error: 'У вас права только на просмотр.' };
const money = z.string().regex(/^\d{1,12}(?:[.,]\d{1,2})?$/, 'Введите сумму, например 15000');

async function monthBudgetId(ctx: AppContext): Promise<{ id: string } | { error: string }> {
  const month = `${ctx.today.slice(0, 7)}-01`;
  const currency = ctx.household.base_currency;
  const found = await ctx.supabase.from('budgets').select('id').eq('household_id', ctx.household.id).eq('month', month).eq('currency', currency).maybeSingle();
  if (found.error) return { error: dbError(found.error.message) };
  if (found.data) return { id: (found.data as { id: string }).id };
  const ins = await ctx.supabase.from('budgets').insert({ household_id: ctx.household.id, month, currency }).select('id').single();
  if (ins.error) return { error: dbError(ins.error.message) };
  return { id: (ins.data as { id: string }).id };
}

export async function setCategoryLimit(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!WRITE.includes(ctx.role)) return NO_WRITE;
  const parsed = z.object({ categoryId: z.string().uuid('Выберите категорию'), amount: money }).safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const cat = ctx.categories.find((c) => c.id === parsed.data.categoryId);
  if (!cat || cat.kind !== 'expense') return { ok: false, fieldErrors: { categoryId: 'Лимит можно задать только на категорию расходов' } };
  const b = await monthBudgetId(ctx);
  if ('error' in b) return { ok: false, error: b.error };
  const { error } = await ctx.supabase
    .from('budget_limits')
    .upsert({ budget_id: b.id, category_id: cat.id, limit_amount: amountToString(parseAmount(parsed.data.amount)) }, { onConflict: 'budget_id,category_id' });
  if (error) return { ok: false, error: dbError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Лимит сохранён' };
}

export async function removeLimit(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!WRITE.includes(ctx.role)) return NO_WRITE;
  const { error, count } = await ctx.supabase.from('budget_limits').delete({ count: 'exact' }).eq('id', id);
  if (error) return { ok: false, error: dbError(error.message) };
  if (!count) return { ok: false, error: 'Лимит не найден.' };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Лимит удалён' };
}

export async function setDailyLimit(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!WRITE.includes(ctx.role)) return NO_WRITE;
  const parsed = z.object({ amount: money.optional() }).safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const b = await monthBudgetId(ctx);
  if ('error' in b) return { ok: false, error: b.error };
  const { error } = await ctx.supabase.from('budgets').update({ daily_limit: parsed.data.amount ? amountToString(parseAmount(parsed.data.amount)) : null }).eq('id', b.id);
  if (error) return { ok: false, error: dbError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: true, message: parsed.data.amount ? 'Дневной лимит сохранён' : 'Дневной лимит снят' };
}

export async function createGoal(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!WRITE.includes(ctx.role)) return NO_WRITE;
  const parsed = z
    .object({
      name: z.string().min(1, 'Укажите название').max(80),
      currency: z.enum(CURRENCIES),
      targetAmount: money,
      currentAmount: money.default('0'),
      targetDate: z.string().refine(isIsoDate, 'Укажите дату').optional(),
    })
    .safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  if (parseAmount(v.targetAmount) <= 0n) return { ok: false, fieldErrors: { targetAmount: 'Цель должна быть больше нуля' } };
  if (v.targetDate && v.targetDate <= ctx.today) return { ok: false, fieldErrors: { targetDate: 'Срок должен быть в будущем' } };
  const { error } = await ctx.supabase.from('financial_goals').insert({
    household_id: ctx.household.id, name: v.name, currency: v.currency,
    target_amount: amountToString(parseAmount(v.targetAmount)), current_amount: amountToString(parseAmount(v.currentAmount)),
    target_date: v.targetDate ?? null,
  });
  if (error) return { ok: false, error: dbError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Цель создана' };
}

/** Adds to a goal's saved amount. The update is guarded by the value that was read, so concurrent edits don't overwrite each other. */
export async function contributeToGoal(id: string, _p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!WRITE.includes(ctx.role)) return NO_WRITE;
  const parsed = z.object({ amount: money }).safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { data, error } = await ctx.supabase.from('financial_goals').select('current_amount, target_amount, status').eq('id', id).eq('household_id', ctx.household.id).maybeSingle();
  if (error || !data) return { ok: false, error: 'Цель не найдена.' };
  const g = data as { current_amount: number | string; target_amount: number | string; status: string };
  const next = toMinor(g.current_amount) + parseAmount(parsed.data.amount);
  const { error: e2, count } = await ctx.supabase
    .from('financial_goals')
    .update({ current_amount: amountToString(next), status: next >= toMinor(g.target_amount) ? 'achieved' : g.status }, { count: 'exact' })
    .eq('id', id)
    .eq('current_amount', g.current_amount);
  if (e2) return { ok: false, error: dbError(e2.message) };
  if (!count) return { ok: false, error: 'Цель изменилась одновременно. Повторите.' };
  revalidatePath('/', 'layout');
  return { ok: true, message: next >= toMinor(g.target_amount) ? 'Цель достигнута!' : 'Накопление добавлено' };
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!WRITE.includes(ctx.role)) return NO_WRITE;
  const { error, count } = await ctx.supabase.from('financial_goals').delete({ count: 'exact' }).eq('id', id).eq('household_id', ctx.household.id);
  if (error) return { ok: false, error: dbError(error.message) };
  if (!count) return { ok: false, error: 'Цель не найдена.' };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Цель удалена' };
}
