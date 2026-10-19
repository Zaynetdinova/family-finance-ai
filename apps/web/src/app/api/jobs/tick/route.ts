import { NextResponse, type NextRequest } from 'next/server';
import { isAuthorizedCron } from '@/lib/cron-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { createTelegramApi } from '@/lib/telegram/api';
import { createSupabaseJobStore } from '@/lib/jobs/store';
import { jobRender } from '@/lib/jobs/render';
import { runTick } from '@/lib/jobs/run';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Hourly scheduler entry point (n8n / cron-job.org / Vercel Cron):
 * scheduled summaries, payment reminders and budget alerts. Safe to call more often or twice:
 * every message is deduplicated in notifications_sent.
 */
async function handle(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get('authorization'))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !process.env.SUPABASE_SECRET_KEY) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  const tg = createTelegramApi(token);
  try {
    const result = await runTick({
      store: createSupabaseJobStore(createAdminClient()),
      send: (chatId, html) => tg.sendMessage(chatId, html),
      render: jobRender,
      now: () => new Date(),
      log: (msg, meta) => console.error(`[jobs] ${msg}`, meta ?? {}),
    });
    return NextResponse.json({ ok: result.errors.length === 0, ...result }, { status: result.errors.length ? 207 : 200 });
  } catch (e) {
    console.error('[jobs] tick failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: 'tick failed' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
