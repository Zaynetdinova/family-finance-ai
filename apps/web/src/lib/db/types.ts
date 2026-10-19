import type { Currency } from '@/lib/finance/money';
import type { DebtDirection, TransactionStatus, TransactionType } from '@/lib/finance/types';

// PostgREST returns `numeric` columns as JSON numbers (or strings, depending on settings).
export type Numeric = number | string;

export interface ProfileRow {
  id: string;
  display_name: string | null;
  base_currency: Currency;
  timezone: string;
  locale: string;
  telegram_user_id: number | null;
}

export interface HouseholdRow {
  id: string;
  name: string;
  base_currency: Currency;
}

export interface MemberRow {
  household_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  profiles?: { display_name: string | null } | null;
}

export interface AccountRow {
  id: string;
  household_id: string;
  name: string;
  type: 'cash' | 'card' | 'savings' | 'credit' | 'investment' | 'other';
  currency: Currency;
  opening_balance: Numeric;
  is_archived: boolean;
}

export interface CategoryRow {
  id: string;
  household_id: string | null;
  parent_id: string | null;
  name: string;
  kind: 'income' | 'expense';
  is_fixed: boolean;
  is_system: boolean;
}

export interface TransactionRow {
  id: string;
  household_id: string;
  created_by: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: Numeric;
  currency: Currency;
  account_id: string;
  transfer_account_id: string | null;
  transfer_amount: Numeric | null;
  category_id: string | null;
  occurred_on: string;
  counterparty: string | null;
  comment: string | null;
  base_currency: Currency | null;
  fx_rate: Numeric | null;
  fx_rate_date: string | null;
  fx_rate_source: string | null;
  base_amount: Numeric | null;
  debt_id: string | null;
  principal_amount: Numeric | null;
  interest_amount: Numeric | null;
  fee_amount: Numeric | null;
  refund_of_id: string | null;
  source: 'telegram' | 'web' | 'manual' | 'import';
  raw_message: string | null;
  external_message_id: string | null;
  created_at: string;
}

export interface DebtRow {
  id: string;
  household_id: string;
  direction: DebtDirection;
  kind: 'loan' | 'mortgage' | 'credit_card' | 'personal' | 'other';
  name: string;
  counterparty: string | null;
  currency: Currency;
  original_amount: Numeric;
  current_balance: Numeric;
  interest_rate: Numeric | null;
  rate_type: 'fixed' | 'variable';
  min_payment: Numeric | null;
  payment_day: number | null;
  opened_on: string | null;
  due_date: string | null;
  allows_prepayment: boolean;
  priority: boolean;
  status: 'active' | 'closed';
  notes: string | null;
}

export interface DebtPaymentRow {
  id: string;
  debt_id: string;
  transaction_id: string;
  paid_on: string;
  principal: Numeric;
  interest: Numeric;
  fees: Numeric;
}

export interface BudgetRow {
  id: string;
  household_id: string;
  month: string;
  currency: Currency;
  daily_limit: Numeric | null;
}

export interface BudgetLimitRow {
  id: string;
  budget_id: string;
  category_id: string;
  limit_amount: Numeric;
}

export interface GoalRow {
  id: string;
  household_id: string;
  name: string;
  currency: Currency;
  target_amount: Numeric;
  current_amount: Numeric;
  target_date: string | null;
  account_id: string | null;
  status: 'active' | 'achieved' | 'paused' | 'cancelled';
}

export interface ExchangeRateRow {
  base_currency: Currency;
  quote_currency: Currency;
  rate: Numeric;
  rate_date: string;
  source: string;
}
