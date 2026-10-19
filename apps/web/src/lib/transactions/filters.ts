import { isIsoDate } from '@/lib/finance/dates';
import { isCurrency, type Currency } from '@/lib/finance/money';
import { TX_TYPES } from './schema';

export const PAGE_SIZE = 25;

export interface TxFilters {
  q: string;
  type: (typeof TX_TYPES)[number] | '';
  categoryId: string;
  accountId: string;
  currency: Currency | '';
  status: 'confirmed' | 'pending_confirmation' | 'draft' | 'cancelled' | '';
  from: string;
  to: string;
  sort: 'date' | 'amount';
  dir: 'asc' | 'desc';
  page: number;
}

const STATUSES = ['confirmed', 'pending_confirmation', 'draft', 'cancelled'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** URL parameters → validated filters. Anything unrecognised is dropped, never passed to the database. */
export function parseTxFilters(sp: Record<string, string | string[] | undefined>): TxFilters {
  const type = first(sp.type);
  const status = first(sp.status);
  const cur = first(sp.currency);
  const from = first(sp.from);
  const to = first(sp.to);
  const page = Number.parseInt(first(sp.page), 10);
  return {
    q: first(sp.q).slice(0, 80),
    type: (TX_TYPES as readonly string[]).includes(type) ? (type as TxFilters['type']) : '',
    categoryId: UUID.test(first(sp.category)) ? first(sp.category) : '',
    accountId: UUID.test(first(sp.account)) ? first(sp.account) : '',
    currency: isCurrency(cur) ? cur : '',
    status: (STATUSES as readonly string[]).includes(status) ? (status as TxFilters['status']) : '',
    from: isIsoDate(from) ? from : '',
    to: isIsoDate(to) ? to : '',
    sort: first(sp.sort) === 'amount' ? 'amount' : 'date',
    dir: first(sp.dir) === 'asc' ? 'asc' : 'desc',
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 10_000) : 1,
  };
}

/** Escape characters that have meaning in PostgREST `or`/`ilike` filters. */
export function searchTerm(q: string): string {
  return q.replace(/[%_\\,()*]/g, ' ').trim();
}
