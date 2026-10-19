import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createTelegramApi } from '@/lib/telegram/api';
import { verifyWebhookSecret } from '@/lib/telegram/update';
import { openAiConfigFromEnv } from '@/lib/ai/openai';
import { createSupabaseBotStore } from '@/lib/bot/store';
import { createBotViews } from '@/lib/bot/views';
import { handleUpdate } from '@/lib/bot/handler';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const log = (msg: string, meta?: Record<string, unknown>) => console.error(`[telegram] ${msg}`, meta ?? {});

/**
 * Telegram webhook. Authenticated by the secret token configured in setWebhook.
 * Always answers 200 for authenticated requests (processing errors are reported to the user
 * in chat), so Telegram does not retry endlessly; duplicates are dropped by update_id.
 */
export async function POST(request: NextRequest) {
  if (!verifyWebhookSecret(request.headers.get('x-telegram-bot-api-secret-token'), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !process.env.SUPABASE_SECRET_KEY) {
    log('bot is not configured: TELEGRAM_BOT_TOKEN or SUPABASE_SECRET_KEY missing');
    return NextResponse.json({ error: 'not configured' }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  await handleUpdate(body, {
    tg: createTelegramApi(token),
    store: createSupabaseBotStore(createAdminClient()),
    ai: openAiConfigFromEnv(),
    views: createBotViews(log),
    webUrl: process.env.APP_URL,
    log,
  });
  return NextResponse.json({ ok: true });
}
