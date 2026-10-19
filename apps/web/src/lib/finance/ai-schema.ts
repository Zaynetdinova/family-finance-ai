import { z } from 'zod';

const decimalText = z.string().regex(/^\d{1,12}(?:[.,]\d{1,2})?$/, 'amount must be digits with at most 2 decimals');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * What the language model is allowed to return for a chat message.
 * It only *extracts* what the user wrote: amounts are copied as text (the model does no
 * arithmetic, no FX), the currency is copied verbatim as `currency_raw` and resolved by
 * deterministic code. Every field is required-but-nullable, as OpenAI structured outputs
 * require.
 */
export const extractionSchema = z
  .object({
    intent: z.enum(['record_transaction', 'question', 'other']),
    type: z.enum(['income', 'expense', 'transfer', 'debt_payment', 'refund']).nullable(),
    amount: decimalText.nullable(),
    currency_raw: z.string().max(40).nullable(),
    category_hint: z.string().max(80).nullable(),
    counterparty: z.string().max(120).nullable(),
    comment: z.string().max(500).nullable(),
    occurred_on: isoDate.nullable(),
    account_hint: z.string().max(80).nullable(),
    to_account_hint: z.string().max(80).nullable(),
    /** Amount credited to the destination account, only if the user stated it. */
    transfer_amount: decimalText.nullable(),
    debt_hint: z.string().max(80).nullable(),
    principal_amount: decimalText.nullable(),
    interest_amount: decimalText.nullable(),
    fee_amount: decimalText.nullable(),
    confidence: z.number().min(0).max(1),
    clarification_question: z.string().max(300).nullable(),
  })
  .strict();

export type Extraction = z.infer<typeof extractionSchema>;

/** JSON Schema to hand to the OpenAI `response_format: json_schema` option. */
export function extractionJsonSchema() {
  return z.toJSONSchema(extractionSchema, { target: 'draft-7' });
}

export type ParseResult = { ok: true; value: Extraction } | { ok: false; error: string };

/** Validate raw model output (string or object). Invalid output is rejected, never "repaired". */
export function parseExtraction(raw: unknown): ParseResult {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'model output is not valid JSON' };
    }
  }
  const r = extractionSchema.safeParse(data);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
}
