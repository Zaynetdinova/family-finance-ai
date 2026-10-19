import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildContext, loadRecentRates, type AppContext } from '@/lib/db/queries';
import { rateRow } from '@/lib/db/convert';
import type { RateRow } from '@/lib/finance/fx';
import type { TransactionRow } from '@/lib/db/types';

export interface PendingAction {
  id: string;
  userId: string;
  householdId: string;
  transactionId: string | null;
  kind: string;
  payload: Record<string, unknown>;
}

export interface AiLog {
  userId: string | null;
  householdId: string | null;
  kind: string;
  inputText: string | null;
  output: unknown;
  status: 'ok' | 'invalid_output' | 'error' | 'needs_clarification' | 'rate_limited';
  error?: string | null;
  model?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  transactionId?: string | null;
}

/** Everything the bot reads or writes. The production implementation uses the service key and scopes every query explicitly. */
export interface BotStore {
  claimUpdate(updateId: number): Promise<boolean>;
  finishUpdate(updateId: number, status: string): Promise<void>;
  userIdByTelegram(telegramUserId: number): Promise<string | null>;
  linkTelegram(codeHash: string, telegramUserId: number, chatId: number): Promise<'ok' | 'invalid'>;
  loadContext(userId: string): Promise<AppContext | null>;
  rates(ctx: AppContext): Promise<RateRow[]>;
  merchantHistory(householdId: string): Promise<Record<string, string>>;
  defaultAccounts(userId: string, householdId: string): Promise<Record<string, string>>;
  aiCallsSince(userId: string, sinceIso: string): Promise<number>;
  logAi(entry: AiLog): Promise<void>;
  insertTransaction(row: Record<string, unknown>): Promise<{ id: string } | { duplicate: true } | { error: string }>;
  getTransaction(id: string, householdId: string): Promise<TransactionRow | null>;
  updateTransaction(id: string, householdId: string, patch: Record<string, unknown>): Promise<boolean>;
  lastTelegramTransaction(userId: string, householdId: string): Promise<TransactionRow | null>;
  createPending(p: Omit<PendingAction, 'id'>): Promise<string>;
  getPending(id: string, userId: string): Promise<PendingAction | null>;
  latestPending(userId: string, kind: string): Promise<PendingAction | null>;
  deletePending(id: string): Promise<void>;
  clearPending(userId: string): Promise<void>;
}

const pendingFrom = (r: Record<string, unknown>): PendingAction => ({
  id: r.id as string,
  userId: r.user_id as string,
  householdId: r.household_id as string,
  transactionId: (r.transaction_id as string | null) ?? null,
  kind: r.kind as string,
  payload: (r.payload as Record<string, unknown>) ?? {},
});

export function createSupabaseBotStore(db: SupabaseClient): BotStore {
  return {
    async claimUpdate(updateId) {
      const { error } = await db.from('telegram_updates').insert({ update_id: updateId });
      if (!error) return true;
      if (error.code === '23505') return false; // already received: Telegram retried
      throw new Error(`telegram_updates: ${error.message}`);
    },
    async finishUpdate(updateId, status) {
      await db.from('telegram_updates').update({ processed_at: new Date().toISOString(), status }).eq('update_id', updateId);
    },
    async userIdByTelegram(tgId) {
      const { data } = await db.from('profiles').select('id').eq('telegram_user_id', tgId).maybeSingle();
      return (data as { id: string } | null)?.id ?? null;
    },
    async linkTelegram(codeHash, tgId, chatId) {
      const now = new Date().toISOString();
      // Single use: the update succeeds only for an unused, unexpired code.
      const { data } = await db
        .from('telegram_link_codes')
        .update({ used_at: now })
        .eq('code_hash', codeHash)
        .is('used_at', null)
        .gt('expires_at', now)
        .select('user_id')
        .maybeSingle();
      const userId = (data as { user_id: string } | null)?.user_id;
      if (!userId) return 'invalid';
      // A Telegram account can belong to one app account: detach it from any previous one.
      await db.from('profiles').update({ telegram_user_id: null, telegram_chat_id: null }).eq('telegram_user_id', tgId).neq('id', userId);
      const { error } = await db.from('profiles').update({ telegram_user_id: tgId, telegram_chat_id: chatId }).eq('id', userId);
      return error ? 'invalid' : 'ok';
    },
    async loadContext(userId) {
      const { data } = await db.from('profiles').select('id').eq('id', userId).maybeSingle();
      if (!data) return null;
      return buildContext(db, { id: userId, email: null }, null);
    },
    async rates(ctx) {
      return (await loadRecentRates(ctx, 30)).map(rateRow);
    },
    async defaultAccounts(userId, householdId) {
      const { data } = await db.from('default_accounts').select('currency, account_id').eq('user_id', userId).eq('household_id', householdId);
      return Object.fromEntries(((data ?? []) as { currency: string; account_id: string }[]).map((r) => [r.currency, r.account_id]));
    },
    async merchantHistory(householdId) {
      const { data } = await db
        .from('transactions')
        .select('counterparty, category_id')
        .eq('household_id', householdId)
        .eq('status', 'confirmed')
        .not('counterparty', 'is', null)
        .not('category_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(300);
      const out: Record<string, string> = {};
      for (const r of (data ?? []) as { counterparty: string; category_id: string }[]) {
        const k = r.counterparty.trim().toLowerCase().replace(/ё/g, 'е');
        if (!(k in out)) out[k] = r.category_id; // most recent choice wins
      }
      return out;
    },
    async aiCallsSince(userId, since) {
      const { count } = await db.from('ai_interactions').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since);
      return count ?? 0;
    },
    async logAi(e) {
      await db.from('ai_interactions').insert({
        user_id: e.userId, household_id: e.householdId, channel: 'telegram', kind: e.kind,
        input_text: e.inputText?.slice(0, 2000) ?? null, structured_output: e.output ?? null, status: e.status,
        error: e.error ?? null, model: e.model ?? null, tokens_in: e.tokensIn ?? null, tokens_out: e.tokensOut ?? null,
        transaction_id: e.transactionId ?? null,
      });
    },
    async insertTransaction(row) {
      const { data, error } = await db.from('transactions').insert(row).select('id').single();
      if (error) return error.code === '23505' ? { duplicate: true } : { error: error.message };
      return { id: (data as { id: string }).id };
    },
    async getTransaction(id, householdId) {
      const { data } = await db.from('transactions').select('*').eq('id', id).eq('household_id', householdId).maybeSingle();
      return (data as TransactionRow | null) ?? null;
    },
    async updateTransaction(id, householdId, patch) {
      const { error, count } = await db.from('transactions').update(patch, { count: 'exact' }).eq('id', id).eq('household_id', householdId);
      return !error && (count ?? 0) > 0;
    },
    async lastTelegramTransaction(userId, householdId) {
      const { data } = await db
        .from('transactions')
        .select('*')
        .eq('household_id', householdId)
        .eq('created_by', userId)
        .eq('source', 'telegram')
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as TransactionRow | null) ?? null;
    },
    async createPending(p) {
      const { data, error } = await db
        .from('pending_actions')
        .insert({ user_id: p.userId, household_id: p.householdId, transaction_id: p.transactionId, kind: p.kind, payload: p.payload })
        .select('id')
        .single();
      if (error) throw new Error(`pending_actions: ${error.message}`);
      return (data as { id: string }).id;
    },
    async getPending(id, userId) {
      const { data } = await db.from('pending_actions').select('*').eq('id', id).eq('user_id', userId).gt('expires_at', new Date().toISOString()).maybeSingle();
      return data ? pendingFrom(data as Record<string, unknown>) : null;
    },
    async latestPending(userId, kind) {
      const { data } = await db
        .from('pending_actions')
        .select('*')
        .eq('user_id', userId)
        .eq('kind', kind)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? pendingFrom(data as Record<string, unknown>) : null;
    },
    async deletePending(id) {
      await db.from('pending_actions').delete().eq('id', id);
    },
    async clearPending(userId) {
      await db.from('pending_actions').delete().eq('user_id', userId);
    },
  };
}
