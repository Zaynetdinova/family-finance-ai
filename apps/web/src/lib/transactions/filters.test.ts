import { describe, expect, it } from 'vitest';
import { parseTxFilters, searchTerm } from './filters';

describe('parseTxFilters', () => {
  it('accepts valid values and drops invalid ones', () => {
    const f = parseTxFilters({ type: 'expense', currency: 'USD', from: '2026-10-01', to: 'nope', status: 'x', sort: 'amount', dir: 'asc', page: '3', category: 'not-a-uuid' });
    expect(f).toMatchObject({ type: 'expense', currency: 'USD', from: '2026-10-01', to: '', status: '', sort: 'amount', dir: 'asc', page: 3, categoryId: '' });
  });
  it('defaults and clamps', () => {
    expect(parseTxFilters({})).toMatchObject({ sort: 'date', dir: 'desc', page: 1, q: '' });
    expect(parseTxFilters({ page: '-4' }).page).toBe(1);
    expect(parseTxFilters({ page: 'abc' }).page).toBe(1);
  });
  it('strips characters that could alter a PostgREST filter', () => {
    expect(searchTerm('a,b%c_d(e)*')).toBe('a b c d e');
    expect(searchTerm('Магнит')).toBe('Магнит');
  });
});
