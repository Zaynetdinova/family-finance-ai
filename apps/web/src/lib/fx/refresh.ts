import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchProviderRates } from './provider';

/** Fetch today's rates and upsert them. Idempotent: the same (pair, date, source) is replaced, not duplicated. */
export async function refreshRates(): Promise<{ ok: true; updated: number; date: string } | { ok: false; error: string }> {
  const fetched = await fetchProviderRates();
  if (!fetched.ok) return fetched;
  const admin = createAdminClient();
  const { error } = await admin
    .from('exchange_rates')
    .upsert(fetched.rows, { onConflict: 'base_currency,quote_currency,rate_date,source' });
  if (error) return { ok: false, error: `Could not save rates: ${error.message}` };
  return { ok: true, updated: fetched.rows.length, date: fetched.rows[0]!.rate_date };
}
