import type { Extraction } from './ai-schema';
import { type Currency, type Minor, CURRENCIES, parseAmount } from './money';
import { type IsoDate, addDays, isIsoDate } from './dates';
import { resolveCurrency, type CurrencyContext } from './currency';
import { type FxSnapshot, type RateRow, snapshotFx } from './fx';
import type { AccountRef, CategoryRef, DebtDirection, TransactionType } from './types';

export const DEBT_CATEGORY_NAME = 'Ипотека и кредиты';
export const FALLBACK_EXPENSE_CATEGORY = 'Прочее';
export const FALLBACK_INCOME_CATEGORY = 'Прочие доходы';
export const CONFIDENCE_THRESHOLD = 0.75;

export interface DebtRef {
  id: string;
  name: string;
  currency: Currency;
  direction: DebtDirection;
  status: 'active' | 'closed';
}

export interface NormalizeContext extends CurrencyContext {
  today: IsoDate;
  baseCurrency: Currency;
  accounts: AccountRef[];
  categories: CategoryRef[];
  debts?: DebtRef[];
  rates: RateRow[];
  defaultAccountId?: string;
  /** lower-cased counterparty → category the user previously chose for it */
  merchantHistory?: Record<string, string>;
  confidenceThreshold?: number;
  /** Idempotency key of the source message, e.g. "telegram:123:456". */
  externalMessageId?: string;
  rawMessage?: string;
  source: 'telegram' | 'web' | 'manual' | 'import';
}

export interface TransactionDraft {
  type: TransactionType;
  amount: Minor;
  currency: Currency;
  accountId: string;
  transferAccountId: string | null;
  transferAmount: Minor | null;
  categoryId: string | null;
  occurredOn: IsoDate;
  counterparty: string | null;
  comment: string | null;
  debtId: string | null;
  principal: Minor | null;
  interest: Minor | null;
  fee: Minor | null;
  fx: FxSnapshot | null;
  source: NormalizeContext['source'];
  rawMessage: string | null;
  externalMessageId: string | null;
}

export type ClarificationField =
  | 'type' | 'amount' | 'currency' | 'account' | 'to_account' | 'transfer_amount' | 'debt' | 'debt_split' | 'date';

export interface Clarification {
  field: ClarificationField;
  question: string;
  options?: { value: string; label: string }[];
}

export type NormalizeResult =
  | { status: 'not_a_transaction' }
  | { status: 'needs_clarification'; clarifications: Clarification[] }
  | {
      status: 'needs_confirmation';
      draft: TransactionDraft;
      reasons: string[];
      warnings: string[];
      categoryOptions: { id: string; name: string }[];
    }
  | { status: 'ready'; draft: TransactionDraft; warnings: string[] };

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');

function matchByName<T extends { name: string }>(items: T[], hint: string): T[] {
  const h = norm(hint);
  if (!h) return [];
  const exact = items.filter((i) => norm(i.name) === h);
  if (exact.length) return exact;
  return items.filter((i) => norm(i.name).includes(h) || h.includes(norm(i.name)));
}

function safeAmount(s: string | null): Minor | null {
  if (s === null) return null;
  try {
    return parseAmount(s);
  } catch {
    return null;
  }
}

/**
 * Turn validated AI output into a transaction draft using deterministic rules.
 * It never guesses a currency from an ambiguous symbol, never invents amounts or FX rates,
 * and asks for clarification whenever the money-relevant meaning is unclear.
 */
export function normalizeExtraction(ex: Extraction, ctx: NormalizeContext): NormalizeResult {
  if (ex.intent !== 'record_transaction') return { status: 'not_a_transaction' };

  const clar: Clarification[] = [];
  const reasons: string[] = [];
  const warnings: string[] = [];
  const type = ex.type;

  if (!type) {
    return {
      status: 'needs_clarification',
      clarifications: [{ field: 'type', question: ex.clarification_question ?? 'Это доход, расход или перевод?' }],
    };
  }

  // ── amount ──
  const amount = safeAmount(ex.amount);
  if (amount === null || amount <= 0n) {
    clar.push({ field: 'amount', question: 'Какая сумма операции?' });
  }

  // ── accounts ──
  const live = ctx.accounts;
  let account: AccountRef | undefined;
  let accountAmbiguous = false;
  if (ex.account_hint) {
    const m = matchByName(live, ex.account_hint);
    if (m.length === 1) account = m[0];
    else accountAmbiguous = true;
  }

  // ── currency ──
  let currency: Currency | undefined;
  const res = resolveCurrency(ex.currency_raw, ctx);
  if (res.status === 'resolved') currency = res.currency;
  else if (res.status === 'ambiguous') {
    clar.push({
      field: 'currency',
      question:
        res.reason === 'dollar_sign'
          ? 'Символ «$» может означать доллары США или аргентинские песо. Какая валюта?'
          : 'Это аргентинские песо? В других странах тоже есть песо — уточните валюту.',
      options: (res.reason === 'dollar_sign' ? res.candidates : [...res.candidates]).map((c) => ({ value: c, label: c })),
    });
  } else if (res.status === 'unsupported') {
    clar.push({
      field: 'currency',
      question: `Валюта «${res.raw}» не поддерживается. Доступны: ${CURRENCIES.join(', ')}.`,
      options: CURRENCIES.map((c) => ({ value: c, label: c })),
    });
  } else {
    // currency not mentioned at all: derive from an explicitly named account, but ask to confirm
    const src = account ?? undefined;
    if (src) {
      currency = src.currency;
      reasons.push(`Валюта не указана, взята валюта счёта «${src.name}» (${src.currency}).`);
    } else {
      clar.push({
        field: 'currency',
        question: 'В какой валюте сумма?',
        options: CURRENCIES.map((c) => ({ value: c, label: c })),
      });
    }
  }

  // Pick the account for non-transfer types once currency is known
  if (!account && currency && !accountAmbiguous) {
    const sameCcy = live.filter((a) => a.currency === currency);
    const def = ctx.defaultAccountId ? sameCcy.find((a) => a.id === ctx.defaultAccountId) : undefined;
    if (def) account = def;
    else if (sameCcy.length === 1) account = sameCcy[0];
  }
  if (account && currency && account.currency !== currency) {
    clar.push({
      field: 'account',
      question: `Счёт «${account.name}» в ${account.currency}, а сумма в ${currency}. С какого счёта операция?`,
      options: live.filter((a) => a.currency === currency).map((a) => ({ value: a.id, label: a.name })),
    });
    account = undefined;
  } else if (!account && currency) {
    const options = live.filter((a) => a.currency === currency).map((a) => ({ value: a.id, label: a.name }));
    clar.push({
      field: 'account',
      question: options.length
        ? `С какого счёта (${currency})?`
        : `Нет счёта в ${currency}. Создайте счёт или укажите другой.`,
      options,
    });
  }

  // ── date ──
  let occurredOn = ctx.today;
  if (ex.occurred_on) {
    if (!isIsoDate(ex.occurred_on)) clar.push({ field: 'date', question: 'Не удалось понять дату. Какого числа?' });
    else if (ex.occurred_on > addDays(ctx.today, 1)) {
      clar.push({ field: 'date', question: `Дата ${ex.occurred_on} в будущем. Какого числа была операция?` });
    } else {
      occurredOn = ex.occurred_on;
      if (occurredOn < addDays(ctx.today, -366)) reasons.push(`Дата операции старше года: ${occurredOn}.`);
    }
  }

  // ── type-specific ──
  let transferAccount: AccountRef | undefined;
  let transferAmount: Minor | null = null;
  let debt: DebtRef | undefined;
  let principal: Minor | null = null;
  let interest: Minor | null = null;
  let fee: Minor | null = null;

  if (type === 'transfer') {
    const m = ex.to_account_hint ? matchByName(live, ex.to_account_hint) : [];
    if (m.length === 1) transferAccount = m[0];
    else
      clar.push({
        field: 'to_account',
        question: 'На какой счёт перевод?',
        options: live.filter((a) => a.id !== account?.id).map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` })),
      });
    if (transferAccount && account && transferAccount.id === account.id) {
      clar.push({ field: 'to_account', question: 'Счёт списания и счёт зачисления совпадают. Куда перевод?' });
      transferAccount = undefined;
    }
    if (transferAccount && account && transferAccount.currency !== account.currency) {
      transferAmount = safeAmount(ex.transfer_amount);
      if (transferAmount === null || transferAmount <= 0n) {
        clar.push({
          field: 'transfer_amount',
          question: `Сколько ${transferAccount.currency} поступило на «${transferAccount.name}»?`,
        });
      }
    } else if (transferAccount && account) {
      transferAmount = amount;
    }
  }

  if (type === 'debt_payment') {
    const debts = (ctx.debts ?? []).filter((d) => d.status === 'active');
    const candidates = ex.debt_hint ? matchByName(debts, ex.debt_hint) : currency ? debts.filter((d) => d.currency === currency) : debts;
    if (candidates.length === 1) {
      debt = candidates[0];
      if (!ex.debt_hint) reasons.push(`Долг не указан, выбран единственный подходящий: «${debt!.name}».`);
    } else {
      clar.push({
        field: 'debt',
        question: 'По какому долгу платёж?',
        options: debts.map((d) => ({ value: d.id, label: `${d.name} (${d.currency})` })),
      });
    }
    if (amount !== null && amount > 0n) {
      const p = safeAmount(ex.principal_amount);
      const i = safeAmount(ex.interest_amount);
      const f = safeAmount(ex.fee_amount);
      if (p !== null) {
        const total = p + (i ?? 0n) + (f ?? 0n);
        if (total !== amount) {
          clar.push({ field: 'debt_split', question: 'Основной долг, проценты и комиссии не дают общую сумму платежа. Уточните разбивку.' });
        } else {
          principal = p; interest = i ?? 0n; fee = f ?? 0n;
        }
      } else if (i !== null || f !== null) {
        const rest = amount - (i ?? 0n) - (f ?? 0n);
        if (rest < 0n) {
          clar.push({ field: 'debt_split', question: 'Проценты и комиссии больше суммы платежа. Уточните разбивку.' });
        } else {
          principal = rest; interest = i ?? 0n; fee = f ?? 0n;
        }
      } else {
        principal = amount; interest = 0n; fee = 0n;
        reasons.push('Разбивка платежа не указана: вся сумма записана как основной долг, проценты 0. Уточните, если часть была процентами.');
      }
    }
  }

  if (clar.length || !currency || amount === null || amount <= 0n || !account) {
    return { status: 'needs_clarification', clarifications: clar };
  }
  if (type === 'transfer' && (!transferAccount || transferAmount === null)) {
    return { status: 'needs_clarification', clarifications: clar };
  }
  if (type === 'debt_payment' && (!debt || principal === null)) {
    return { status: 'needs_clarification', clarifications: clar };
  }

  // ── category ──
  let categoryId: string | null = null;
  let categoryOptions: { id: string; name: string }[] = [];
  if (type !== 'transfer') {
    const kind = type === 'income' ? 'income' : 'expense';
    const pool = ctx.categories.filter((c) => c.kind === kind);
    if (type === 'debt_payment') {
      categoryId = pool.find((c) => !c.parentId && c.name === DEBT_CATEGORY_NAME)?.id ?? null;
    } else {
      const byHint = ex.category_hint ? matchByName(pool, ex.category_hint) : [];
      const hist = ex.counterparty ? ctx.merchantHistory?.[norm(ex.counterparty)] : undefined;
      if (byHint.length === 1) categoryId = byHint[0]!.id;
      else if (hist && pool.some((c) => c.id === hist)) categoryId = hist;
      if (byHint.length > 1) categoryOptions = byHint.slice(0, 4).map((c) => ({ id: c.id, name: c.name }));
      if (!categoryId) {
        const fb = pool.find((c) => !c.parentId && c.name === (kind === 'income' ? FALLBACK_INCOME_CATEGORY : FALLBACK_EXPENSE_CATEGORY));
        categoryId = fb?.id ?? null;
        reasons.push('Категория не определена, временно «' + (fb?.name ?? '—') + '».');
        if (!categoryOptions.length) categoryOptions = pool.filter((c) => !c.parentId).slice(0, 4).map((c) => ({ id: c.id, name: c.name }));
      }
    }
  }

  if (ex.confidence < (ctx.confidenceThreshold ?? CONFIDENCE_THRESHOLD)) {
    reasons.push(`Низкая уверенность распознавания (${Math.round(ex.confidence * 100)}%).`);
  }

  // ── FX snapshot ──
  const fx = snapshotFx(amount, currency, ctx.baseCurrency, ctx.rates, occurredOn);
  if (!fx) {
    warnings.push(`Нет курса ${currency}→${ctx.baseCurrency} на ${occurredOn}: операция сохранится в исходной валюте и не войдёт в суммы в ${ctx.baseCurrency}, пока курс не появится.`);
  }

  const draft: TransactionDraft = {
    type,
    amount,
    currency,
    accountId: account.id,
    transferAccountId: transferAccount?.id ?? null,
    transferAmount: type === 'transfer' ? transferAmount : null,
    categoryId,
    occurredOn,
    counterparty: ex.counterparty,
    comment: ex.comment,
    debtId: debt?.id ?? null,
    principal,
    interest,
    fee,
    fx,
    source: ctx.source,
    rawMessage: ctx.rawMessage ?? null,
    externalMessageId: ctx.externalMessageId ?? null,
  };

  return reasons.length
    ? { status: 'needs_confirmation', draft, reasons, warnings, categoryOptions }
    : { status: 'ready', draft, warnings };
}
