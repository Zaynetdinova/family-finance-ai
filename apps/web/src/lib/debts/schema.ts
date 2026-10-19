import { z } from 'zod';
import { CURRENCIES } from '@/lib/finance/money';
import { isIsoDate } from '@/lib/finance/dates';

const money = z.string().regex(/^\d{1,12}(?:[.,]\d{1,2})?$/, 'Введите сумму, например 1500 или 1500,50');
const date = z.string().refine(isIsoDate, 'Укажите дату');

export const debtInputSchema = z
  .object({
    name: z.string().min(1, 'Укажите название').max(80),
    direction: z.enum(['owed_by_me', 'owed_to_me']),
    kind: z.enum(['loan', 'mortgage', 'credit_card', 'personal', 'other']),
    currency: z.enum(CURRENCIES),
    originalAmount: money,
    currentBalance: money,
    interestRate: z.string().regex(/^\d{1,3}(?:[.,]\d{1,4})?$/, 'Ставка в процентах годовых, например 12,5').optional(),
    rateType: z.enum(['fixed', 'variable']).default('fixed'),
    minPayment: money.optional(),
    paymentDay: z.coerce.number().int().min(1, 'От 1 до 31').max(31, 'От 1 до 31').optional(),
    openedOn: date.optional(),
    dueDate: date.optional(),
    counterparty: z.string().max(120).optional(),
    allowsPrepayment: z.string().optional(),
    priority: z.string().optional(),
    notes: z.string().max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    const num = (s: string) => Number(s.replace(',', '.'));
    if (num(v.currentBalance) > num(v.originalAmount)) {
      ctx.addIssue({ code: 'custom', path: ['currentBalance'], message: 'Остаток не может превышать первоначальную сумму' });
    }
    if (v.openedOn && v.dueDate && v.dueDate < v.openedOn) {
      ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'Срок раньше даты открытия' });
    }
  });

export type DebtInput = z.infer<typeof debtInputSchema>;
