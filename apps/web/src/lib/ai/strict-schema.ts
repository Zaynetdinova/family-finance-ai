import { z } from 'zod';

type Json = Record<string, unknown>;

// Validation keywords are dropped from what we send to the model (support varies by model);
// the full Zod schema is still enforced on the response.
const DROP = new Set(['$schema', 'pattern', 'format', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'default']);

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== 'object') return node;
  const out: Json = {};
  for (const [k, v] of Object.entries(node as Json)) {
    if (DROP.has(k)) continue;
    out[k] = clean(v);
  }
  if (out.type === 'object' && out.properties) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as Json); // strict mode: every property is required (nullable instead of optional)
  }
  return out;
}

/** JSON Schema for OpenAI `response_format: { type: 'json_schema', strict: true }`. */
export function toStrictJsonSchema(schema: z.ZodType): Json {
  return clean(z.toJSONSchema(schema, { target: 'draft-7' })) as Json;
}
