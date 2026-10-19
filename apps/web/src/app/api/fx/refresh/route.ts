import { NextResponse, type NextRequest } from 'next/server';
import { refreshRates } from '@/lib/fx/refresh';
import { isAuthorizedCron } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

/** Called by a scheduler (n8n / cron) with `Authorization: Bearer $CRON_SECRET`. */
async function handle(request: NextRequest) {
  if (!isAuthorizedCron(request.headers.get('authorization'))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const result = await refreshRates();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

export const GET = handle;
export const POST = handle;
