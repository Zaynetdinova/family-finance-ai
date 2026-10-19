import type { LedgerTx } from './types';
import { diffDays } from './dates';

/** Stable idempotency key for a Telegram message; the same message always maps to the same key. */
export function telegramExternalId(chatId: number | string, messageId: number | string): string {
  return `tg:${chatId}:${messageId}`;
}

/**
 * Possible duplicates among *different* messages (e.g. the same purchase entered by both
 * spouses, or a repeated receipt photo): same type, amount, currency and account within
 * `windowDays`. Returned as groups for the user to review — never deleted automatically.
 */
export function findPossibleDuplicates(txs: LedgerTx[], windowDays = 1): LedgerTx[][] {
  const live = txs.filter((t) => t.status === 'confirmed' || t.status === 'pending_confirmation');
  const groups = new Map<string, LedgerTx[]>();
  for (const t of live) {
    const key = `${t.type}|${t.amount}|${t.currency}|${t.accountId}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const out: LedgerTx[][] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const sorted = [...g].sort((a, b) => (a.occurredOn < b.occurredOn ? -1 : 1));
    let cluster: LedgerTx[] = [sorted[0]!];
    for (const t of sorted.slice(1)) {
      if (diffDays(cluster[cluster.length - 1]!.occurredOn, t.occurredOn) <= windowDays) cluster.push(t);
      else {
        if (cluster.length > 1) out.push(cluster);
        cluster = [t];
      }
    }
    if (cluster.length > 1) out.push(cluster);
  }
  return out;
}
