import { z } from 'zod';

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error?: string; fieldErrors?: Record<string, string> };

export const idle: ActionResult | null = null;

/** Flatten Zod issues to { field: first message }. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_');
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Strings from FormData, trimmed; empty → undefined. */
export function formObject(fd: FormData): Record<string, string | undefined> {
  const o: Record<string, string | undefined> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    o[k] = t === '' ? undefined : t;
  }
  return o;
}

/** Postgres/PostgREST errors → text safe to show (no internals). */
export function dbError(message: string): string {
  if (/row-level security/i.test(message)) return 'Недостаточно прав для этого действия.';
  if (/duplicate key|unique/i.test(message)) return 'Такая запись уже существует.';
  if (/foreign key/i.test(message)) return 'Связанная запись не найдена или используется.';
  if (/violates check constraint/i.test(message)) return 'Данные не прошли проверку целостности.';
  return message.length < 200 ? message : 'Не удалось сохранить данные.';
}
