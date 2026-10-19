import type { Extraction } from './ai-schema';
import { parseAmount, parseRate, type Currency } from './money';
import type { RateRow } from './fx';
import type { NormalizeContext, DebtRef } from './normalize';
import type { AccountRef, CategoryRef, LedgerTx } from './types';

export const accounts: AccountRef[] = [
  { id: 'acc-card', name: 'Карта', currency: 'RUB', openingBalance: parseAmount('50000') },
  { id: 'acc-save', name: 'Накопительный счёт', currency: 'RUB', openingBalance: parseAmount('300000') },
  { id: 'acc-usd', name: 'Доллары', currency: 'USD', openingBalance: 0n },
  { id: 'acc-ars', name: 'Песо кошелёк', currency: 'ARS', openingBalance: 0n },
];

export const categories: CategoryRef[] = [
  { id: 'c-home', name: 'Жильё и коммунальные услуги', kind: 'expense', isFixed: true },
  { id: 'c-debt', name: 'Ипотека и кредиты', kind: 'expense', isFixed: true },
  { id: 'c-food', name: 'Продукты', kind: 'expense' },
  { id: 'c-cafe', name: 'Кафе и рестораны', kind: 'expense' },
  { id: 'c-other', name: 'Прочее', kind: 'expense' },
  { id: 'c-salary', name: 'Зарплата', kind: 'income' },
  { id: 'c-oth-inc', name: 'Прочие доходы', kind: 'income' },
];

export const debts: DebtRef[] = [
  { id: 'debt-mortgage', name: 'Ипотека', currency: 'RUB', direction: 'owed_by_me', status: 'active' },
];

const rate = (base: Currency, quote: Currency, r: string, date: string, source = 'test'): RateRow => ({
  base, quote, rate: parseRate(r), date, source,
});

export const rates: RateRow[] = [
  rate('USD', 'RUB', '90', '2026-10-15'),
  rate('USD', 'ARS', '1000', '2026-10-15'),
];

export const ctx: NormalizeContext = {
  today: '2026-10-18',
  baseCurrency: 'RUB',
  accounts,
  categories,
  debts,
  rates,
  defaultAccountId: 'acc-card',
  source: 'telegram',
};

export function extraction(p: Partial<Extraction> = {}): Extraction {
  return {
    intent: 'record_transaction', type: 'expense', amount: null, currency_raw: null,
    category_hint: null, counterparty: null, comment: null, occurred_on: null,
    account_hint: null, to_account_hint: null, transfer_amount: null, debt_hint: null,
    principal_amount: null, interest_amount: null, fee_amount: null,
    confidence: 0.95, clarification_question: null, ...p,
  };
}

let n = 0;
/** Confirmed RUB transaction in the base currency. */
export function tx(p: Partial<LedgerTx> & Pick<LedgerTx, 'type' | 'amount'>): LedgerTx {
  return {
    id: `t${++n}`, status: 'confirmed', currency: 'RUB', accountId: 'acc-card', occurredOn: '2026-09-10', ...p,
  };
}
export const rub = (s: string) => parseAmount(s);
