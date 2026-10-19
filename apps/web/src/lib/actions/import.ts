'use server';
import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireContext, loadRecentRates } from '@/lib/db/queries';
import { rateRow } from '@/lib/db/convert';
import { buildTransaction } from '@/lib/transactions/build';
import { transactionInputSchema } from '@/lib/transactions/schema';
import { parseCsv, parseDateCell, parseTypeAlias } from '@/lib/transactions/csv';
import { dbError } from './result';

const MAX_BYTES = 1_000_000;
const MAX_ROWS = 2000;

export type ImportResult =
  | { ok: true; imported: number; skipped: number; errors: string[] }
  | { ok: false; error: string };

/**
 * CSV columns: date, type, amount, currency?, account, to_account?, category?, counterparty?, comment?
 * Every row gets a stable external id (hash of its content + occurrence number), so importing the
 * same file twice does not create duplicates.
 */
export async function importTransactions(_prev: ImportResult | null, fd: FormData): Promise<ImportResult> {
  const ctx = await requireContext();
  if (!['owner', 'admin', 'member'].includes(ctx.role)) return { ok: false, error: 'У вас права только на просмотр.' };

  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Выберите CSV-файл.' };
  if (file.size > MAX_BYTES) return { ok: false, error: 'Файл больше 1 МБ.' };

  const rows = parseCsv(await file.text());
  const header = rows.shift()?.map((h) => h.trim().toLowerCase());
  if (!header) return { ok: false, error: 'Файл пуст.' };
  if (rows.length > MAX_ROWS) return { ok: false, error: `Не более ${MAX_ROWS} строк за раз.` };
  for (const need of ['date', 'type', 'amount', 'account']) {
    if (!header.includes(need)) return { ok: false, error: `Нет обязательной колонки «${need}».` };
  }
  const col = (r: string[], name: string) => (r[header.indexOf(name)] ?? '').trim();

  const accByName = new Map(ctx.accounts.map((a) => [a.name.toLowerCase(), a]));
  const catByName = new Map(ctx.categories.map((c) => [c.name.toLowerCase(), c]));
  const rates = (await loadRecentRates(ctx, 400)).map(rateRow);
  const env = {
    householdId: ctx.household.id,
    userId: ctx.userId,
    baseCurrency: ctx.household.base_currency,
    accounts: ctx.accounts.map((a) => ({ id: a.id, currency: a.currency })),
    debts: [],
    rates,
  };

  const errors: string[] = [];
  const prepared: Record<string, unknown>[] = [];
  const seen = new Map<string, number>();

  rows.forEach((r, idx) => {
    const line = idx + 2;
    const fail = (msg: string) => errors.push(`Строка ${line}: ${msg}`);
    const date = parseDateCell(col(r, 'date'));
    const type = parseTypeAlias(col(r, 'type'));
    const account = accByName.get(col(r, 'account').toLowerCase());
    if (!date) return fail('не распознана дата (ГГГГ-ММ-ДД или ДД.ММ.ГГГГ)');
    if (!type) return fail('неизвестный тип операции');
    if (type === 'debt_payment') return fail('платежи по долгам импортируйте через форму');
    if (!account) return fail(`счёт «${col(r, 'account')}» не найден`);
    const currency = col(r, 'currency').toUpperCase();
    if (currency && currency !== account.currency) return fail(`валюта ${currency} не совпадает с валютой счёта (${account.currency})`);
    const toAccount = col(r, 'to_account') ? accByName.get(col(r, 'to_account').toLowerCase()) : undefined;
    if (type === 'transfer' && !toAccount) return fail('для перевода нужен счёт зачисления (to_account)');
    const categoryCell = col(r, 'category').split('›').pop()!.trim().toLowerCase();
    const category = categoryCell ? catByName.get(categoryCell) : undefined;

    const parsed = transactionInputSchema.safeParse({
      type, amount: col(r, 'amount').replace(/\s/g, ''), accountId: account.id, occurredOn: date,
      categoryId: category?.id, counterparty: col(r, 'counterparty') || undefined, comment: col(r, 'comment') || undefined,
      transferAccountId: toAccount?.id, status: 'confirmed',
    });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'некорректные данные');
    const built = buildTransaction(parsed.data, env);
    if (!built.ok) return fail(Object.values(built.fieldErrors)[0] ?? 'некорректные данные');

    const base = createHash('sha1').update(`${ctx.household.id}|${r.join('\u0001')}`).digest('hex').slice(0, 24);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    prepared.push({ ...built.row, created_by: ctx.userId, source: 'import', external_message_id: `import:${base}:${n}` });
  });

  // Skip rows that were imported before
  const ids = prepared.map((p) => p.external_message_id as string);
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await ctx.supabase
      .from('transactions')
      .select('external_message_id')
      .eq('household_id', ctx.household.id)
      .eq('source', 'import')
      .in('external_message_id', ids.slice(i, i + 200));
    if (error) return { ok: false, error: dbError(error.message) };
    for (const d of data ?? []) existing.add((d as { external_message_id: string }).external_message_id);
  }
  const fresh = prepared.filter((p) => !existing.has(p.external_message_id as string));

  for (let i = 0; i < fresh.length; i += 200) {
    const { error } = await ctx.supabase.from('transactions').insert(fresh.slice(i, i + 200));
    if (error) return { ok: false, error: `Импорт остановлен на строках ${i + 1}–${i + 200}: ${dbError(error.message)}` };
  }

  revalidatePath('/', 'layout');
  return { ok: true, imported: fresh.length, skipped: prepared.length - fresh.length, errors: errors.slice(0, 20) };
}
