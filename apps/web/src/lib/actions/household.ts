'use server';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { amountToString, CURRENCIES, parseAmount } from '@/lib/finance/money';
import { dbError, fieldErrors, formObject, type ActionResult } from './result';

const currency = z.enum(CURRENCIES);
const amountText = z.string().regex(/^-?\d{1,12}(?:[.,]\d{1,2})?$/, 'Введите сумму, например 1500 или 1500,50');

const onboarding = z.object({
  householdName: z.string().min(1, 'Укажите название').max(80),
  baseCurrency: currency,
  accountName: z.string().min(1, 'Укажите название счёта').max(80),
  accountType: z.enum(['cash', 'card', 'savings', 'credit', 'investment', 'other']),
  accountCurrency: currency,
  openingBalance: amountText.default('0'),
});

export async function createHousehold(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = onboarding.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'Сессия истекла. Войдите снова.' };

  // The id is generated here so we don't need to SELECT the new row back before the
  // owner-membership trigger result is visible to the select policy.
  const householdId = randomUUID();
  const h = await supabase
    .from('households')
    .insert({ id: householdId, name: v.householdName, base_currency: v.baseCurrency, created_by: auth.user.id });
  if (h.error) return { ok: false, error: dbError(h.error.message) };

  const a = await supabase.from('accounts').insert({
    household_id: householdId,
    owner_id: auth.user.id,
    name: v.accountName,
    type: v.accountType,
    currency: v.accountCurrency,
    opening_balance: amountToString(parseAmount(v.openingBalance)),
  });
  if (a.error) return { ok: false, error: dbError(a.error.message) };

  await supabase.from('profiles').update({ base_currency: v.baseCurrency }).eq('id', auth.user.id);
  redirect('/');
}
