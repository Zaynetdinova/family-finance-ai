import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/finance/period';
import { addDays } from '@/lib/finance/dates';
import type {
  AccountRow, CategoryRow, DebtRow, ExchangeRateRow, HouseholdRow, MemberRow, ProfileRow, TransactionRow,
} from './types';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface AppContext {
  supabase: Supabase;
  userId: string;
  email: string | null;
  profile: ProfileRow;
  household: HouseholdRow;
  role: MemberRow['role'];
  members: { userId: string; name: string; role: MemberRow['role'] }[];
  accounts: AccountRow[];
  categories: CategoryRow[];
  debts: DebtRow[];
  today: string;
}

const PAGE = 1000;

/** Reads every row of a query; PostgREST caps a single response at 1000 rows. */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
}

/**
 * Everything a page needs about the signed-in user and their household, loaded once per request.
 * Redirects to /login when signed out and to /onboarding when the user has no household yet.
 */
export const getAppContext = cache(async (opts: { allowNoHousehold?: boolean } = {}): Promise<AppContext | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) redirect('/login');

  let profile = (await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()).data as ProfileRow | null;
  if (!profile) {
    const ins = await supabase.from('profiles').insert({ id: user.id }).select('*').single();
    profile = must(ins, 'profile') as ProfileRow;
  }

  const memberships = must(
    await supabase.from('household_members').select('household_id, role').eq('user_id', user.id).order('created_at'),
    'memberships',
  ) as { household_id: string; role: MemberRow['role'] }[];

  const first = memberships[0];
  if (!first) {
    if (opts.allowNoHousehold) return null;
    redirect('/onboarding');
  }

  const hid = first.household_id;
  const [household, members, accounts, categories, debts] = await Promise.all([
    supabase.from('households').select('*').eq('id', hid).single(),
    supabase.from('household_members').select('user_id, role, profiles(display_name)').eq('household_id', hid),
    supabase.from('accounts').select('*').eq('household_id', hid).order('created_at'),
    supabase.from('categories').select('*').or(`household_id.is.null,household_id.eq.${hid}`).order('name'),
    supabase.from('debts').select('*').eq('household_id', hid).order('created_at'),
  ]);

  return {
    supabase,
    userId: user.id,
    email: user.email ?? null,
    profile,
    household: must(household, 'household') as HouseholdRow,
    role: first.role,
    members: (must(members, 'members') as unknown as MemberRow[]).map((m) => ({
      userId: m.user_id,
      name: m.profiles?.display_name || 'Участник',
      role: m.role,
    })),
    accounts: must(accounts, 'accounts') as AccountRow[],
    categories: must(categories, 'categories') as CategoryRow[],
    debts: must(debts, 'debts') as DebtRow[],
    today: todayIn(profile.timezone),
  };
});

/** Like getAppContext but guarantees a household (the common case). */
export async function requireContext(): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx) redirect('/onboarding');
  return ctx;
}

export async function loadTransactions(
  ctx: AppContext,
  opts: { from: string; to: string; statuses?: string[]; userId?: string | null },
): Promise<TransactionRow[]> {
  return fetchAll<TransactionRow>((a, b) => {
    let q = ctx.supabase
      .from('transactions')
      .select('*')
      .eq('household_id', ctx.household.id)
      .gte('occurred_on', opts.from)
      .lte('occurred_on', opts.to)
      .in('status', opts.statuses ?? ['confirmed'])
      .order('occurred_on', { ascending: true })
      .order('created_at', { ascending: true })
      .range(a, b);
    if (opts.userId) q = q.eq('created_by', opts.userId);
    return q;
  });
}

/** Rates of the last `days` days: enough to snapshot a new transaction; old ones keep their stored rate. */
export async function loadRecentRates(ctx: AppContext, days = 14): Promise<ExchangeRateRow[]> {
  const { data, error } = await ctx.supabase
    .from('exchange_rates')
    .select('base_currency, quote_currency, rate, rate_date, source')
    .gte('rate_date', addDays(ctx.today, -days))
    .order('rate_date', { ascending: false })
    .limit(500);
  if (error) throw new Error(`rates: ${error.message}`);
  return (data ?? []) as ExchangeRateRow[];
}
