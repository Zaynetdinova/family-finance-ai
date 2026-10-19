import { amountToString, rateToString } from '@/lib/finance/money';
import type { TransactionDraft } from '@/lib/finance/normalize';

/** Normalized draft → `transactions` row. Status decides whether it counts in reports immediately. */
export function draftToRow(d: TransactionDraft, householdId: string, userId: string, status: 'confirmed' | 'pending_confirmation') {
  const s = (v: bigint | null) => (v === null ? null : amountToString(v));
  return {
    household_id: householdId,
    created_by: userId,
    type: d.type,
    status,
    amount: amountToString(d.amount),
    currency: d.currency,
    account_id: d.accountId,
    transfer_account_id: d.transferAccountId,
    transfer_amount: s(d.transferAmount),
    category_id: d.categoryId,
    occurred_on: d.occurredOn,
    counterparty: d.counterparty,
    comment: d.comment,
    debt_id: d.debtId,
    principal_amount: s(d.principal),
    interest_amount: s(d.interest),
    fee_amount: s(d.fee),
    base_currency: d.fx?.baseCurrency ?? null,
    fx_rate: d.fx ? rateToString(d.fx.rate) : null,
    fx_rate_date: d.fx?.rateDate ?? null,
    fx_rate_source: d.fx?.source ?? null,
    base_amount: d.fx ? amountToString(d.fx.baseAmount) : null,
    source: d.source,
    raw_message: d.rawMessage ? d.rawMessage.slice(0, 2000) : null,
    external_message_id: d.externalMessageId,
  };
}
