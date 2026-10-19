'use server';
import { createHash, randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ACTIVE_HOUSEHOLD_COOKIE, requireContext } from '@/lib/db/queries';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { refreshRates } from '@/lib/fx/refresh';
import { amountToString, CURRENCIES, parseAmount, parseRate, rateToString } from '@/lib/finance/money';
import { isIsoDate } from '@/lib/finance/dates';
import { dbError, fieldErrors, formObject, type ActionResult } from './result';

const isAdmin = (role: string) => role === 'owner' || role === 'admin';
const NO_ADMIN: ActionResult = { ok: false, error: 'Для этого действия нужны права администратора.' };
const NO_WRITE: ActionResult = { ok: false, error: 'У вас права только на просмотр.' };

const currency = z.enum(CURRENCIES);
const amountText = z.string().regex(/^-?\d{1,12}(?:[.,]\d{1,2})?$/, 'Введите сумму, например 1500 или 1500,50');

export async function createAccount(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!['owner', 'admin', 'member'].includes(ctx.role)) return NO_WRITE;
  const parsed = z
    .object({
      name: z.string().min(1, 'Укажите название').max(80),
      type: z.enum(['cash', 'card', 'savings', 'credit', 'investment', 'other']),
      currency,
      openingBalance: amountText.default('0'),
    })
    .safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const { error } = await ctx.supabase.from('accounts').insert({
    household_id: ctx.household.id, owner_id: ctx.userId, name: v.name, type: v.type, currency: v.currency,
    opening_balance: amountToString(parseAmount(v.openingBalance)),
  });
  if (error) return { ok: false, error: /unique/i.test(error.message) ? 'Счёт с таким названием уже есть.' : dbError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Счёт добавлен' };
}

export async function archiveAccount(id: string, archived: boolean): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!['owner', 'admin', 'member'].includes(ctx.role)) return NO_WRITE;
  const { error } = await ctx.supabase.from('accounts').update({ is_archived: archived }).eq('id', id).eq('household_id', ctx.household.id);
  if (error) return { ok: false, error: dbError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: true, message: archived ? 'Счёт в архиве' : 'Счёт восстановлен' };
}

export async function createCategory(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!['owner', 'admin', 'member'].includes(ctx.role)) return NO_WRITE;
  const parsed = z
    .object({
      name: z.string().min(1, 'Укажите название').max(60),
      kind: z.enum(['income', 'expense']),
      parentId: z.string().uuid().optional(),
      isFixed: z.string().optional(),
    })
    .safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const parent = v.parentId ? ctx.categories.find((c) => c.id === v.parentId) : undefined;
  if (v.parentId && (!parent || parent.kind !== v.kind || parent.parent_id)) return { ok: false, fieldErrors: { parentId: 'Выберите родительскую категорию того же типа' } };
  const { error } = await ctx.supabase.from('categories').insert({
    household_id: ctx.household.id, parent_id: v.parentId ?? null, name: v.name, kind: v.kind, is_fixed: v.isFixed === 'on', is_system: false,
  });
  if (error) return { ok: false, error: /unique/i.test(error.message) ? 'Такая категория уже есть.' : dbError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Категория добавлена' };
}

/** Creates an invite and returns the one-time link (the token itself is never stored). */
export async function createInvite(_p: ActionResult | null, fd: FormData): Promise<ActionResult & { link?: string }> {
  const ctx = await requireContext();
  if (!isAdmin(ctx.role)) return NO_ADMIN;
  const parsed = z.object({ role: z.enum(['admin', 'member', 'viewer']) }).safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const token = randomBytes(32).toString('base64url');
  const { error } = await ctx.supabase.from('household_invites').insert({
    household_id: ctx.household.id, role: parsed.data.role, created_by: ctx.userId,
    token_hash: createHash('sha256').update(token, 'utf8').digest('hex'),
  });
  if (error) return { ok: false, error: dbError(error.message) };
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https');
  return { ok: true, message: 'Ссылка действует 7 дней и сработает один раз.', link: `${proto}://${host}/join?token=${token}` };
}

export async function removeMember(userId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!isAdmin(ctx.role) && userId !== ctx.userId) return NO_ADMIN;
  const target = ctx.members.find((m) => m.userId === userId);
  if (!target) return { ok: false, error: 'Участник не найден.' };
  if (target.role === 'owner') return { ok: false, error: 'Владельца нельзя удалить.' };
  const { error, count } = await ctx.supabase.from('household_members').delete({ count: 'exact' }).eq('household_id', ctx.household.id).eq('user_id', userId);
  if (error) return { ok: false, error: dbError(error.message) };
  if (!count) return { ok: false, error: 'Не удалось удалить участника.' };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Участник удалён' };
}

export async function acceptInvite(token: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('accept_household_invite', { p_token: token });
  if (error) {
    return { ok: false, error: /invalid_or_expired/.test(error.message) ? 'Приглашение недействительно или истекло.' : 'Не удалось принять приглашение.' };
  }
  (await cookies()).set(ACTIVE_HOUSEHOLD_COOKIE, String(data), { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  redirect('/');
}

export async function switchHousehold(id: string): Promise<void> {
  const ctx = await requireContext();
  if (ctx.households.some((h) => h.id === id)) {
    (await cookies()).set(ACTIVE_HOUSEHOLD_COOKIE, id, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
  }
  revalidatePath('/', 'layout');
}

export async function updateHouseholdSettings(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!isAdmin(ctx.role)) return NO_ADMIN;
  const parsed = z.object({ name: z.string().min(1, 'Укажите название').max(80), baseCurrency: currency }).safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { error } = await ctx.supabase.from('households').update({ name: parsed.data.name, base_currency: parsed.data.baseCurrency }).eq('id', ctx.household.id);
  if (error) return { ok: false, error: dbError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Настройки сохранены. Уже сохранённые операции остаются в курсах, зафиксированных на момент записи.' };
}

/** Rates are written with the server-side service key only; RLS gives clients read access. */
export async function addManualRate(_p: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!isAdmin(ctx.role)) return NO_ADMIN;
  const parsed = z
    .object({
      base: currency,
      quote: currency,
      rate: z.string().regex(/^\d{1,10}(?:[.,]\d{1,10})?$/, 'Введите курс, например 1050,5'),
      date: z.string().refine(isIsoDate, 'Укажите дату'),
    })
    .safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;
  if (v.base === v.quote) return { ok: false, fieldErrors: { quote: 'Валюты должны отличаться' } };
  if (v.date > ctx.today) return { ok: false, fieldErrors: { date: 'Курс не может быть датирован будущим' } };
  if (!process.env.SUPABASE_SECRET_KEY) return { ok: false, error: 'Не задан SUPABASE_SECRET_KEY: запись курсов отключена.' };
  const { error } = await createAdminClient()
    .from('exchange_rates')
    .upsert({ base_currency: v.base, quote_currency: v.quote, rate: rateToString(parseRate(v.rate)), rate_date: v.date, source: 'manual' }, { onConflict: 'base_currency,quote_currency,rate_date,source' });
  if (error) return { ok: false, error: dbError(error.message) };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Курс сохранён' };
}

export async function refreshRatesNow(): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!isAdmin(ctx.role)) return NO_ADMIN;
  if (!process.env.SUPABASE_SECRET_KEY) return { ok: false, error: 'Не задан SUPABASE_SECRET_KEY: запись курсов отключена.' };
  const r = await refreshRates();
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath('/', 'layout');
  return { ok: true, message: `Курсы обновлены на ${r.date}` };
}

/** Default account per currency for messages that name no account (Telegram). Empty value clears it. */
export async function setDefaultAccount(currency: string, accountId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!(CURRENCIES as readonly string[]).includes(currency)) return { ok: false, error: 'Неизвестная валюта.' };
  if (!accountId) {
    const { error } = await ctx.supabase.from('default_accounts').delete().eq('user_id', ctx.userId).eq('household_id', ctx.household.id).eq('currency', currency);
    if (error) return { ok: false, error: dbError(error.message) };
  } else {
    const acc = ctx.accounts.find((a) => a.id === accountId && a.currency === currency && !a.is_archived);
    if (!acc) return { ok: false, error: 'Счёт не найден или в другой валюте.' };
    const { error } = await ctx.supabase
      .from('default_accounts')
      .upsert({ user_id: ctx.userId, household_id: ctx.household.id, currency, account_id: accountId }, { onConflict: 'user_id,household_id,currency' });
    if (error) return { ok: false, error: dbError(error.message) };
  }
  revalidatePath('/settings');
  return { ok: true, message: 'Счёт по умолчанию сохранён' };
}
