import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { refreshRates } from '@/lib/fx/refresh';

export const dynamic = 'force-dynamic';

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false; // refuse to run unauthenticated
  const given = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Called by a scheduler (n8n / cron) with `Authorization: Bearer $CRON_SECRET`. */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await refreshRates();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

export const GET = handle;
export const POST = handle;
