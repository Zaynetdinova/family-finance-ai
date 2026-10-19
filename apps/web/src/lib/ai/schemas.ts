import { z } from 'zod';
import { extractionSchema } from '@/lib/finance/ai-schema';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const QUESTION_TOPICS = [
  'spending_total', 'income_total', 'top_categories', 'category_spending', 'compare_periods',
  'upcoming_payments', 'debt_strategy', 'savings_capacity', 'balance', 'other',
] as const;

/**
 * One call classifies the message and extracts either a transaction or a question.
 * Transaction fields mirror `extractionSchema`; question fields are null for transactions.
 */
export const messageSchema = extractionSchema
  .extend({
    question_topic: z.enum(QUESTION_TOPICS).nullable(),
    period_from: isoDate.nullable(),
    period_to: isoDate.nullable(),
    compare_from: isoDate.nullable(),
    compare_to: isoDate.nullable(),
  })
  .strict();

export type MessageAnalysis = z.infer<typeof messageSchema>;

export const narrativeSchema = z
  .object({
    summary: z.string().max(900),
    recommendations: z.array(z.string().max(300)).max(3),
  })
  .strict();

export type Narrative = z.infer<typeof narrativeSchema>;
