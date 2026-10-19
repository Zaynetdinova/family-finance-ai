import { z } from 'zod';
import { isIsoDate } from '@/lib/finance/dates';

const amount = z.string().regex(/^\d{1,12}(?:[.,]\d{1,2})?$/, 'Введите сумму, например 1500 или 1500,50');
const optionalAmount = amount.optional();
const uuid = z.string().uuid();

export const TX_TYPES = ['income', 'expense', 'transfer', 'debt_payment', 'refund'] as const;

export const transactionInputSchema = z.object({
  type: z.enum(TX_TYPES),
  amount,
  accountId: uuid,
  occurredOn: z.string().refine(isIsoDate, 'Укажите дату'),
  categoryId: uuid.optional(),
  counterparty: z.string().max(120).optional(),
  comment: z.string().max(500).optional(),
  // transfer
  transferAccountId: uuid.optional(),
  transferAmount: optionalAmount,
  // debt payment
  debtId: uuid.optional(),
  principal: optionalAmount,
  interest: optionalAmount,
  fee: optionalAmount,
  status: z.enum(['confirmed', 'pending_confirmation']).default('confirmed'),
});

export type TransactionInput = z.infer<typeof transactionInputSchema>;
