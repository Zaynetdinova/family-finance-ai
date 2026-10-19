import type { Currency, Minor } from './money';
import type { IsoDate } from './dates';

export type TransactionType = 'income' | 'expense' | 'transfer' | 'debt_payment' | 'refund';
export type TransactionStatus = 'draft' | 'pending_confirmation' | 'confirmed' | 'cancelled';
export type DebtDirection = 'owed_by_me' | 'owed_to_me';

export interface TxFx {
  baseCurrency: Currency;
  rate: bigint;
  rateDate: IsoDate;
  baseAmount: Minor;
}

/** A transaction as the calculation code sees it (all money as bigint minor units). */
export interface LedgerTx {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: Minor;
  currency: Currency;
  accountId: string;
  transferAccountId?: string | null;
  transferAmount?: Minor | null;
  categoryId?: string | null;
  occurredOn: IsoDate;
  counterparty?: string | null;
  principal?: Minor | null;
  interest?: Minor | null;
  fee?: Minor | null;
  debtDirection?: DebtDirection | null;
  fx?: TxFx | null;
}

export interface AccountRef {
  id: string;
  name: string;
  currency: Currency;
  openingBalance?: Minor;
}

export interface CategoryRef {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  parentId?: string | null;
  isFixed?: boolean;
}
