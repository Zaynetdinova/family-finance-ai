'use server';
import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireContext } from '@/lib/db/queries';
import { createAdminClient } from '@/lib/supabase/admin';
import { hashLinkCode } from '@/lib/bot/link-code';
import type { ActionResult } from './result';

const TTL_MINUTES = 15;

/** One-time code for linking Telegram. Only its hash is stored; the code itself is shown once. */
export async function createTelegramLink(): Promise<ActionResult & { link?: string; code?: string }> {
  const ctx = await requireContext();
  const bot = process.env.TELEGRAM_BOT_USERNAME;
  if (!process.env.SUPABASE_SECRET_KEY || !bot) {
    return { ok: false, error: 'Бот не настроен: нужны TELEGRAM_BOT_USERNAME и SUPABASE_SECRET_KEY.' };
  }
  const code = randomBytes(18).toString('base64url'); // 24 chars, allowed in /start payloads
  const admin = createAdminClient();
  await admin.from('telegram_link_codes').delete().eq('user_id', ctx.userId).is('used_at', null);
  const { error } = await admin.from('telegram_link_codes').insert({
    code_hash: hashLinkCode(code),
    user_id: ctx.userId,
    expires_at: new Date(Date.now() + TTL_MINUTES * 60_000).toISOString(),
  });
  if (error) return { ok: false, error: 'Не удалось создать код привязки.' };
  return { ok: true, code, link: `https://t.me/${bot.replace(/^@/, '')}?start=${code}`, message: `Ссылка действует ${TTL_MINUTES} минут.` };
}

export async function unlinkTelegram(): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!process.env.SUPABASE_SECRET_KEY) return { ok: false, error: 'Не задан SUPABASE_SECRET_KEY.' };
  // telegram_* columns are protected from client updates; the server clears them.
  const { error } = await createAdminClient().from('profiles').update({ telegram_user_id: null, telegram_chat_id: null }).eq('id', ctx.userId);
  if (error) return { ok: false, error: 'Не удалось отвязать Telegram.' };
  revalidatePath('/settings');
  return { ok: true, message: 'Telegram отвязан' };
}
