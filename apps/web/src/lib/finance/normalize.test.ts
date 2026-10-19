import { describe, expect, it } from 'vitest';
import { normalizeExtraction } from './normalize';
import { ctx, extraction, rub } from './fixtures';
import { parseAmount } from './money';

describe('normalizeExtraction', () => {
  it('1. RUB expense: "Потратила 8500 рублей на продукты в Магните"', () => {
    const r = normalizeExtraction(
      extraction({ type: 'expense', amount: '8500', currency_raw: 'рублей', category_hint: 'продукты', counterparty: 'Магнит' }), ctx);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.draft).toMatchObject({ type: 'expense', amount: rub('8500'), currency: 'RUB', categoryId: 'c-food', accountId: 'acc-card', occurredOn: '2026-10-18' });
    expect(r.draft.fx).toMatchObject({ baseCurrency: 'RUB', baseAmount: rub('8500') });
  });

  it('2. USD income keeps the original amount and stores the rate used', () => {
    const r = normalizeExtraction(
      extraction({ type: 'income', amount: '2000', currency_raw: 'долларов', category_hint: 'Зарплата' }), ctx);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.draft).toMatchObject({ type: 'income', amount: rub('2000'), currency: 'USD', accountId: 'acc-usd', categoryId: 'c-salary' });
    expect(r.draft.fx).toMatchObject({ baseCurrency: 'RUB', rate: 90n * 10n ** 10n, rateDate: '2026-10-15', baseAmount: rub('180000') });
  });

  it('3. ARS expense: explicit "аргентинских песо", and bare "песо" only with user context', () => {
    const explicit = normalizeExtraction(extraction({ amount: '450', currency_raw: 'аргентинских песо', category_hint: 'Кафе и рестораны' }), ctx);
    expect(explicit.status).toBe('ready');
    if (explicit.status === 'ready') {
      expect(explicit.draft.currency).toBe('ARS');
      expect(explicit.draft.accountId).toBe('acc-ars');
      // ARS→RUB is crossed through USD: 450 / 1000 * 90 = 40.50
      expect(explicit.draft.fx?.baseAmount).toBe(parseAmount('40.50'));
    }
    const bare = normalizeExtraction(extraction({ amount: '450', currency_raw: 'песо' }), ctx);
    expect(bare.status).toBe('needs_clarification');
    const withCtx = normalizeExtraction(extraction({ amount: '450', currency_raw: 'песо' }), { ...ctx, pesoMeans: 'ARS' });
    expect(withCtx.status).not.toBe('needs_clarification');
  });

  it('4. ambiguous currency symbol asks for clarification and saves nothing', () => {
    const r = normalizeExtraction(extraction({ amount: '35', currency_raw: '$' }), ctx);
    expect(r.status).toBe('needs_clarification');
    if (r.status !== 'needs_clarification') return;
    const c = r.clarifications.find((x) => x.field === 'currency');
    expect(c?.options?.map((o) => o.value)).toEqual(['USD', 'ARS']);
  });

  it('asks about missing amount, missing currency and unsupported currency', () => {
    expect(normalizeExtraction(extraction({ amount: null, currency_raw: 'рублей' }), ctx)).toMatchObject({ status: 'needs_clarification' });
    expect(normalizeExtraction(extraction({ amount: '10', currency_raw: null }), ctx)).toMatchObject({ status: 'needs_clarification' });
    expect(normalizeExtraction(extraction({ amount: '10', currency_raw: 'евро' }), ctx)).toMatchObject({ status: 'needs_clarification' });
  });

  it('ignores messages that are not transactions', () => {
    expect(normalizeExtraction(extraction({ intent: 'question' }), ctx)).toEqual({ status: 'not_a_transaction' });
  });

  it('uses the per-currency default account', () => {
    const r = normalizeExtraction(extraction({ amount: '100', currency_raw: 'рублей', category_hint: 'продукты' }), { ...ctx, defaultAccountId: undefined, defaultAccounts: { RUB: 'acc-save' } });
    expect(r.status === 'ready' && r.draft.accountId).toBe('acc-save');
  });

  it('asks which account when the currency has several and no default matches', () => {
    const r = normalizeExtraction(extraction({ amount: '100', currency_raw: 'рублей' }), { ...ctx, defaultAccountId: undefined });
    expect(r.status).toBe('needs_clarification');
  });

  it('5. transfer between own accounts: no category, destination required', () => {
    const r = normalizeExtraction(
      extraction({ type: 'transfer', amount: '20000', currency_raw: 'рублей', account_hint: 'Накопительный', to_account_hint: 'Карта' }), ctx);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.draft).toMatchObject({ type: 'transfer', accountId: 'acc-save', transferAccountId: 'acc-card', transferAmount: rub('20000'), categoryId: null });
    const same = normalizeExtraction(
      extraction({ type: 'transfer', amount: '1', currency_raw: 'рублей', account_hint: 'Карта', to_account_hint: 'Карта' }), ctx);
    expect(same.status).toBe('needs_clarification');
  });

  it('cross-currency transfer requires the credited amount instead of guessing it', () => {
    const base = { type: 'transfer' as const, amount: '9000', currency_raw: 'рублей', account_hint: 'Карта', to_account_hint: 'Доллары' };
    expect(normalizeExtraction(extraction(base), ctx).status).toBe('needs_clarification');
    const ok = normalizeExtraction(extraction({ ...base, transfer_amount: '100' }), ctx);
    expect(ok.status).toBe('ready');
    if (ok.status === 'ready') expect(ok.draft.transferAmount).toBe(rub('100'));
  });

  it('6. refund is a refund, not income', () => {
    const r = normalizeExtraction(extraction({ type: 'refund', amount: '1500', currency_raw: 'рублей', comment: 'отменённый заказ', category_hint: 'Одежда' }), ctx);
    expect(r.status === 'ready' || r.status === 'needs_confirmation').toBe(true);
    if (r.status === 'ready' || r.status === 'needs_confirmation') expect(r.draft.type).toBe('refund');
  });

  it('7. loan payment 10 000 with 4 000 interest splits into 6 000 principal + 4 000 interest', () => {
    const r = normalizeExtraction(
      extraction({ type: 'debt_payment', amount: '10000', currency_raw: 'рублей', interest_amount: '4000', debt_hint: 'ипотека' }), ctx);
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.draft).toMatchObject({ debtId: 'debt-mortgage', principal: rub('6000'), interest: rub('4000'), fee: 0n, categoryId: 'c-debt' });
  });

  it('debt payment: inconsistent split is rejected; missing split needs confirmation', () => {
    const bad = normalizeExtraction(
      extraction({ type: 'debt_payment', amount: '10000', currency_raw: 'рублей', principal_amount: '5000', interest_amount: '4000', debt_hint: 'ипотека' }), ctx);
    expect(bad.status).toBe('needs_clarification');
    const tooMuch = normalizeExtraction(
      extraction({ type: 'debt_payment', amount: '1000', currency_raw: 'рублей', interest_amount: '4000', debt_hint: 'ипотека' }), ctx);
    expect(tooMuch.status).toBe('needs_clarification');
    const none = normalizeExtraction(extraction({ type: 'debt_payment', amount: '10000', currency_raw: 'рублей', debt_hint: 'ипотека' }), ctx);
    expect(none.status).toBe('needs_confirmation');
  });

  it('low confidence or unknown category → confirmation, never silent', () => {
    const low = normalizeExtraction(extraction({ amount: '100', currency_raw: 'рублей', category_hint: 'продукты', confidence: 0.4 }), ctx);
    expect(low.status).toBe('needs_confirmation');
    const unknown = normalizeExtraction(extraction({ amount: '100', currency_raw: 'рублей', category_hint: 'чтототакое' }), ctx);
    expect(unknown.status).toBe('needs_confirmation');
    if (unknown.status === 'needs_confirmation') expect(unknown.draft.categoryId).toBe('c-other');
  });

  it('uses merchant history when the model gave no usable category', () => {
    const r = normalizeExtraction(extraction({ amount: '300', currency_raw: 'рублей', counterparty: 'Магнит' }), { ...ctx, merchantHistory: { магнит: 'c-food' } });
    expect(r.status).toBe('ready');
    if (r.status === 'ready') expect(r.draft.categoryId).toBe('c-food');
  });

  it('rejects future dates and warns when no FX rate exists', () => {
    expect(normalizeExtraction(extraction({ amount: '1', currency_raw: 'рублей', occurred_on: '2027-01-01' }), ctx).status).toBe('needs_clarification');
    const r = normalizeExtraction(extraction({ amount: '10', currency_raw: 'USD', category_hint: 'продукты' }), { ...ctx, rates: [] });
    expect(r.status).toBe('ready');
    if (r.status === 'ready') {
      expect(r.draft.fx).toBeNull();
      expect(r.warnings.length).toBe(1);
    }
  });

  it('carries the idempotency key and raw message into the draft', () => {
    const r = normalizeExtraction(extraction({ amount: '5', currency_raw: 'рублей', category_hint: 'продукты' }), { ...ctx, externalMessageId: 'tg:1:2', rawMessage: 'хлеб 5р' });
    if (r.status === 'ready') expect(r.draft).toMatchObject({ externalMessageId: 'tg:1:2', rawMessage: 'хлеб 5р', source: 'telegram' });
  });
});
