import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env';

/**
 * Privileged client that BYPASSES RLS. Server-only; use for system jobs (exchange-rate import,
 * Telegram webhook). Never import from client components.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('SUPABASE_SECRET_KEY is not set');
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
