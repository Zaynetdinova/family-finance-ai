import type { TransactionType } from '@/lib/finance/types';

/** Labels without JSX, usable from server-only code such as the bot. */
export const TYPE_LABELS: Record<TransactionType, string> = {
  income: 'Доход', expense: 'Расход', transfer: 'Перевод', debt_payment: 'Платёж по долгу', refund: 'Возврат',
};
