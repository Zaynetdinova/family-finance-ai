import type { z } from 'zod';
import { toStrictJsonSchema } from './strict-schema';

export interface AiUsage {
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

export type AiResult<T> =
  | { ok: true; value: T; raw: unknown; usage: AiUsage }
  | { ok: false; error: string; raw?: unknown; usage?: AiUsage };

export interface OpenAiConfig {
  apiKey: string;
  model: string;
  transcriptionModel: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export function openAiConfigFromEnv(): OpenAiConfig | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    transcriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1',
  };
}

/** Errors are reduced to a short code/description; the API key and request bodies never reach logs. */
function describeHttp(status: number): string {
  if (status === 401) return 'OpenAI: invalid API key';
  if (status === 429) return 'OpenAI: rate limit or quota exceeded';
  if (status >= 500) return `OpenAI: server error ${status}`;
  return `OpenAI: HTTP ${status}`;
}

/**
 * Chat Completions with Structured Outputs (json_schema, strict). The response is parsed and
 * then validated again with Zod; anything that does not match is rejected, never repaired.
 */
export async function structuredCompletion<S extends z.ZodType>(
  cfg: OpenAiConfig,
  opts: { name: string; schema: S; system: string; user: string; imageDataUrl?: string; timeoutMs?: number },
): Promise<AiResult<z.infer<S>>> {
  const f = cfg.fetchImpl ?? fetch;
  const content = opts.imageDataUrl
    ? [{ type: 'text', text: opts.user }, { type: 'image_url', image_url: { url: opts.imageDataUrl, detail: 'high' } }]
    : opts.user;
  let res: Response;
  try {
    res = await f(`${cfg.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: opts.name, strict: true, schema: toStrictJsonSchema(opts.schema) },
        },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
  } catch {
    return { ok: false, error: 'OpenAI: network error or timeout' };
  }
  if (!res.ok) return { ok: false, error: describeHttp(res.status) };

  let body: {
    choices?: { message?: { content?: string | null; refusal?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    model?: string;
  };
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: 'OpenAI: invalid JSON response' };
  }
  const usage: AiUsage = { model: body.model ?? cfg.model, tokensIn: body.usage?.prompt_tokens ?? null, tokensOut: body.usage?.completion_tokens ?? null };
  const msg = body.choices?.[0]?.message;
  if (msg?.refusal) return { ok: false, error: 'OpenAI: refused', usage };
  if (!msg?.content) return { ok: false, error: 'OpenAI: empty response', usage };

  let data: unknown;
  try {
    data = JSON.parse(msg.content);
  } catch {
    return { ok: false, error: 'OpenAI: output is not JSON', usage };
  }
  const parsed = opts.schema.safeParse(data);
  if (!parsed.success) return { ok: false, error: 'OpenAI: output does not match schema', raw: data, usage };
  return { ok: true, value: parsed.data, raw: data, usage };
}

/** Speech to text for voice messages. */
export async function transcribe(cfg: OpenAiConfig, audio: ArrayBuffer, filename: string): Promise<AiResult<string>> {
  const f = cfg.fetchImpl ?? fetch;
  const form = new FormData();
  form.append('file', new Blob([audio]), filename);
  form.append('model', cfg.transcriptionModel);
  form.append('language', 'ru');
  let res: Response;
  try {
    res = await f(`${cfg.baseUrl ?? 'https://api.openai.com/v1'}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return { ok: false, error: 'OpenAI: network error or timeout' };
  }
  if (!res.ok) return { ok: false, error: describeHttp(res.status) };
  const body = (await res.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim();
  const usage = { model: cfg.transcriptionModel, tokensIn: null, tokensOut: null };
  return text ? { ok: true, value: text, raw: null, usage } : { ok: false, error: 'OpenAI: empty transcription', usage };
}
