'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { fieldErrors, formObject, type ActionResult } from './result';

const credentials = z.object({
  email: z.email('Введите корректный email'),
  password: z.string().min(8, 'Минимум 8 символов').max(72),
});

export async function signIn(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = credentials.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { ok: false, error: 'Неверный email или пароль, либо почта не подтверждена.' };
  redirect('/');
}

export async function signUp(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = credentials.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') ? 'http' : 'https');
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${proto}://${host}/auth/callback` },
  });
  if (error) return { ok: false, error: 'Не удалось зарегистрироваться: ' + error.message };
  if (data.session) redirect('/');
  return { ok: true, message: 'Мы отправили письмо для подтверждения. Перейдите по ссылке и войдите.' };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
