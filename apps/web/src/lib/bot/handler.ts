import type { AppContext } from '@/lib/db/queries';
import { accountRef, categoryRef, toMinor } from '@/lib/db/convert';
import type { TransactionRow } from '@/lib/db/types';
import { normalizeExtraction, type Clarification, type NormalizeContext, type TransactionDraft } from '@/lib/finance/normalize';
import { telegramExternalId } from '@/lib/finance/dedupe';
import { formatMinor, type Currency } from '@/lib/finance/money';
import { structuredCompletion, transcribe, type OpenAiConfig } from '@/lib/ai/openai';
import { messageSchema, type MessageAnalysis } from '@/lib/ai/schemas';
import { messageSystemPrompt, type PromptContext } from '@/lib/ai/prompts';
import type { InlineKeyboard, TelegramApi } from '@/lib/telegram/api';
import { updateSchema, type TelegramCallback, type TelegramMessage } from '@/lib/telegram/update';
import { cb, dateRu, esc, parseCb } from '@/lib/telegram/format';
import { TYPE_LABELS } from '@/lib/labels-plain';
import type { BotStore } from './store';
import { draftToRow } from './rows';
import { hashLinkCode } from './link-code';

export interface BotViews {
  report(ctx: AppContext, kind: 'daily' | 'weekly' | 'monthly'): Promise<string>;
  analytics(ctx: AppContext): Promise<string>;
  debts(ctx: AppContext): Promise<string>;
  budget(ctx: AppContext): Promise<string>;
  goals(ctx: AppContext): Promise<string>;
  answer(ctx: AppContext, q: MessageAnalysis): Promise<string>;
}

export interface BotDeps {
  tg: TelegramApi;
  store: BotStore;
  ai: OpenAiConfig | null;
  views: BotViews;
  webUrl?: string;
  now?: () => Date;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

const AI_LIMIT = 20; // calls per user per window
const AI_WINDOW_MS = 5 * 60_000;
const MAX_VOICE_SECONDS = 120;
const MAX_VOICE_BYTES = 10_000_000;
const MAX_PHOTO_BYTES = 5_000_000;
const WRITE_ROLES = ['owner', 'admin', 'member'];

export const HELP = [
  '<b>Что я умею</b>',
  'Напишите операцию обычным текстом, например:',
  '• Потратила 8500 рублей на продукты в Магните',
  '• Получила зарплату 120 000 рублей',
  '• Заплатила 35 долларов за ресторан',
  '• Перевела 20 000 рублей с накопительного счёта на карту',
  '• Заплатила 10 000 рублей по ипотеке, из них 4000 — проценты',
  'Можно отправить голосовое сообщение или фото чека.',
  '',
  'Вопросы: «Сколько мы потратили в этом месяце?», «Сравни расходы за сентябрь и август», «Какие платежи на следующей неделе?», «Как быстрее закрыть долги?», «Сколько можно отложить?»',
  '',
  '/today — сводка за день',
  '/week — сводка за неделю',
  '/month — отчёт за месяц',
  '/analytics — основные выводы',
  '/debts — долги и ближайшие платежи',
  '/budget — состояние бюджета',
  '/goals — финансовые цели',
  '/last — последняя операция: отменить или исправить категорию',
  '/cancel — сбросить незавершённое уточнение',
].join('\n');


/** Entry point for one Telegram update. Safe to call again with the same update: it is processed once. */
export async function handleUpdate(raw: unknown, deps: BotDeps): Promise<void> {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return;
  const u = parsed.data;
  if (!(await deps.store.claimUpdate(u.update_id))) return;
  let status = 'ok';
  try {
    if (u.message) await onMessage(u.message, deps);
    else if (u.callback_query) await onCallback(u.callback_query, deps);
    else status = 'ignored';
  } catch (e) {
    status = 'error';
    deps.log?.('bot update failed', { updateId: u.update_id, error: e instanceof Error ? e.message : String(e) });
    const chatId = u.message?.chat.id ?? u.callback_query?.message?.chat.id;
    if (chatId) await deps.tg.sendMessage(chatId, 'Что-то пошло не так. Операция не записана — попробуйте ещё раз чуть позже.').catch(() => undefined);
  } finally {
    await deps.store.finishUpdate(u.update_id, status).catch(() => undefined);
  }
}

// ───────────────────────── messages ─────────────────────────

async function onMessage(msg: TelegramMessage, deps: BotDeps) {
  const chatId = msg.chat.id;
  const say = (text: string, kb?: InlineKeyboard) => deps.tg.sendMessage(chatId, text, kb);
  if (msg.chat.type !== 'private' || !msg.from || msg.from.is_bot) {
    if (msg.chat.type !== 'private') await say('Я работаю только в личных сообщениях.');
    return;
  }
  const text = (msg.text ?? '').trim();

  if (text.startsWith('/start')) {
    const code = text.split(/\s+/)[1];
    if (code) {
      const res = await deps.store.linkTelegram(hashLinkCode(code), msg.from.id, chatId);
      if (res === 'ok') return say(`Аккаунт привязан. Теперь можно записывать операции сообщениями.\n\n${HELP}`);
      return say('Код привязки недействителен или истёк. Создайте новый в веб-приложении: Настройки → Telegram.');
    }
  }

  const userId = await deps.store.userIdByTelegram(msg.from.id);
  if (!userId) {
    return say(`Здравствуйте! Чтобы я мог вести ваш бюджет, привяжите Telegram к аккаунту: откройте ${deps.webUrl ? esc(deps.webUrl) + '/settings' : 'веб-приложение'} → «Telegram» → «Получить ссылку».`);
  }
  const ctx = await deps.store.loadContext(userId);
  if (!ctx) return say('Сначала создайте бюджет и счёт в веб-приложении.');

  const command = text.startsWith('/') ? text.split(/[\s@]/)[0]!.toLowerCase() : null;
  switch (command) {
    case '/start':
    case '/help':
      return say(HELP);
    case '/today':
      return say(await deps.views.report(ctx, 'daily'));
    case '/week':
      return say(await deps.views.report(ctx, 'weekly'));
    case '/month':
      return say(await deps.views.report(ctx, 'monthly'));
    case '/analytics':
      return say(await deps.views.analytics(ctx));
    case '/debts':
      return say(await deps.views.debts(ctx));
    case '/budget':
      return say(await deps.views.budget(ctx));
    case '/goals':
      return say(await deps.views.goals(ctx));
    case '/last':
    case '/undo':
      return showLast(ctx, chatId, deps);
    case '/cancel':
      await deps.store.clearPending(userId);
      return say('Незавершённые уточнения сброшены.');
    case null:
      break;
    default:
      return say('Не знаю такой команды. /help — список возможностей.');
  }

  const externalId = telegramExternalId(chatId, msg.message_id);

  if (msg.voice) {
    if (!deps.ai) return say('Голосовые сообщения недоступны: не настроен OpenAI.');
    if (msg.voice.duration > MAX_VOICE_SECONDS) return say('Голосовое длиннее 2 минут — пожалуйста, короче.');
    if (!(await allowAi(ctx, deps))) return say('Слишком много запросов. Подождите несколько минут.');
    let audio;
    try {
      audio = await deps.tg.downloadFile(msg.voice.file_id, MAX_VOICE_BYTES);
    } catch (e) {
      return say(e instanceof Error && e.message === 'FILE_TOO_LARGE' ? 'Файл слишком большой.' : 'Не удалось скачать голосовое сообщение.');
    }
    const t = await transcribe(deps.ai, audio.data, 'voice.ogg');
    await deps.store.logAi({ userId, householdId: ctx.household.id, kind: 'transcribe', inputText: null, output: t.ok ? { text: t.value } : null, status: t.ok ? 'ok' : 'error', error: t.ok ? null : t.error, model: deps.ai.transcriptionModel });
    if (!t.ok) return say('Не удалось распознать голос. Попробуйте ещё раз или напишите текстом.');
    await say(`🎙 Распознано: «${esc(t.value)}»`);
    return processText(ctx, chatId, t.value, externalId, deps, { raw: `[голос] ${t.value}` });
  }

  if (msg.photo?.length) {
    if (!deps.ai) return say('Распознавание чеков недоступно: не настроен OpenAI.');
    if (!WRITE_ROLES.includes(ctx.role)) return say('У вас права только на просмотр — записывать операции нельзя.');
    if (!(await allowAi(ctx, deps))) return say('Слишком много запросов. Подождите несколько минут.');
    const largest = [...msg.photo].sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
    let img;
    try {
      img = await deps.tg.downloadFile(largest.file_id, MAX_PHOTO_BYTES);
    } catch (e) {
      return say(e instanceof Error && e.message === 'FILE_TOO_LARGE' ? 'Фото слишком большое.' : 'Не удалось скачать фото.');
    }
    const dataUrl = `data:image/jpeg;base64,${Buffer.from(img.data).toString('base64')}`;
    const prompt = `Это фото чека. Извлеки итоговую сумму к оплате (ИТОГО), валюту как написано, магазин, дату покупки. intent = record_transaction, type = expense, если это не возврат.${msg.caption ? ` Подпись пользователя: ${msg.caption}` : ''}`;
    const res = await structuredCompletion(deps.ai, { name: 'receipt', schema: messageSchema, system: messageSystemPrompt(promptContext(ctx)), user: prompt, imageDataUrl: dataUrl });
    await deps.store.logAi({ userId, householdId: ctx.household.id, kind: 'receipt', inputText: msg.caption ?? '[фото чека]', output: res.ok ? res.value : (res.raw ?? null), status: res.ok ? 'ok' : res.error.includes('schema') ? 'invalid_output' : 'error', error: res.ok ? null : res.error, model: res.usage?.model, tokensIn: res.usage?.tokensIn, tokensOut: res.usage?.tokensOut });
    if (!res.ok) return say('Не удалось прочитать чек. Попробуйте более чёткое фото или напишите сумму текстом.');
    // Receipts are always confirmed by the user before they count.
    return processAnalysis(ctx, chatId, res.value, externalId, deps, { raw: `[фото чека] ${msg.caption ?? ''}`.trim(), forceConfirm: true });
  }

  if (!text) return say('Пришлите текст, голосовое сообщение или фото чека. /help — подсказка.');
  const pending = await deps.store.latestPending(userId, 'clarify');
  if (pending) {
    await deps.store.deletePending(pending.id);
    const p = pending.payload as { text: string; question: string; externalId: string };
    const combined = `Исходное сообщение: ${p.text}\nВопрос бота: ${p.question}\nОтвет пользователя: ${text}\n(Если ответ не относится к вопросу, разбери только ответ пользователя.)`;
    return processText(ctx, chatId, combined, p.externalId, deps, { raw: `${p.text} / ${text}` });
  }
  return processText(ctx, chatId, text, externalId, deps, { raw: text });
}

async function allowAi(ctx: AppContext, deps: BotDeps): Promise<boolean> {
  const now = (deps.now ?? (() => new Date()))();
  const calls = await deps.store.aiCallsSince(ctx.userId, new Date(now.getTime() - AI_WINDOW_MS).toISOString());
  if (calls < AI_LIMIT) return true;
  await deps.store.logAi({ userId: ctx.userId, householdId: ctx.household.id, kind: 'rate_limit', inputText: null, output: null, status: 'rate_limited' });
  return false;
}

export function promptContext(ctx: AppContext): PromptContext {
  return {
    today: ctx.today,
    baseCurrency: ctx.household.base_currency,
    accounts: ctx.accounts.filter((a) => !a.is_archived).map((a) => ({ name: a.name, currency: a.currency })),
    categories: ctx.categories.filter((c) => !c.parent_id).map((c) => ({ name: c.name, kind: c.kind })),
    debts: ctx.debts.filter((d) => d.status === 'active').map((d) => ({ name: d.name, currency: d.currency })),
  };
}

async function processText(ctx: AppContext, chatId: number, text: string, externalId: string, deps: BotDeps, meta: { raw: string }) {
  const say = (t: string, kb?: InlineKeyboard) => deps.tg.sendMessage(chatId, t, kb);
  if (!deps.ai) return say('Разбор сообщений недоступен: не настроен OpenAI. Добавьте операцию в веб-приложении.');
  if (!(await allowAi(ctx, deps))) return say('Слишком много запросов. Подождите несколько минут.');
  const res = await structuredCompletion(deps.ai, { name: 'message', schema: messageSchema, system: messageSystemPrompt(promptContext(ctx)), user: text });
  await deps.store.logAi({
    userId: ctx.userId, householdId: ctx.household.id, kind: 'analyze_message', inputText: text,
    output: res.ok ? res.value : (res.raw ?? null), status: res.ok ? 'ok' : res.error.includes('schema') ? 'invalid_output' : 'error',
    error: res.ok ? null : res.error, model: res.usage?.model, tokensIn: res.usage?.tokensIn, tokensOut: res.usage?.tokensOut,
  });
  if (!res.ok) return say('Не получилось разобрать сообщение. Переформулируйте, например: «Потратила 500 рублей на кофе».');
  return processAnalysis(ctx, chatId, res.value, externalId, deps, { raw: meta.raw });
}

async function processAnalysis(ctx: AppContext, chatId: number, a: MessageAnalysis, externalId: string, deps: BotDeps, meta: { raw: string; forceConfirm?: boolean }) {
  const say = (t: string, kb?: InlineKeyboard) => deps.tg.sendMessage(chatId, t, kb);
  if (a.intent === 'question') return say(await deps.views.answer(ctx, a));
  if (a.intent !== 'record_transaction') return say('Не понял, это операция или вопрос? Например: «Потратила 500 рублей на кофе» или «Сколько потратили за неделю?». /help');
  if (!WRITE_ROLES.includes(ctx.role)) return say('У вас права только на просмотр — записывать операции нельзя.');

  const nctx: NormalizeContext = {
    today: ctx.today,
    baseCurrency: ctx.household.base_currency,
    accounts: ctx.accounts.filter((x) => !x.is_archived).map(accountRef),
    categories: ctx.categories.map(categoryRef),
    debts: ctx.debts.map((d) => ({ id: d.id, name: d.name, currency: d.currency, direction: d.direction, status: d.status })),
    rates: await deps.store.rates(ctx),
    merchantHistory: await deps.store.merchantHistory(ctx.household.id),
    defaultAccounts: await deps.store.defaultAccounts(ctx.userId, ctx.household.id),
    // A bare "песо" means ARS only for users who keep an ARS account.
    pesoMeans: ctx.accounts.some((x) => x.currency === 'ARS' && !x.is_archived) ? 'ARS' : undefined,
    externalMessageId: externalId,
    rawMessage: meta.raw,
    source: 'telegram',
  };
  const r = normalizeExtraction(a, nctx);

  if (r.status === 'not_a_transaction') return say('Не нашёл в сообщении операцию. /help');
  if (r.status === 'needs_clarification') return askClarification(ctx, chatId, a, r.clarifications, externalId, meta.raw, deps);

  const confirm = r.status === 'needs_confirmation' || meta.forceConfirm;
  const ins = await deps.store.insertTransaction(draftToRow(r.draft, ctx.household.id, ctx.userId, confirm ? 'pending_confirmation' : 'confirmed'));
  if ('duplicate' in ins) return say('Это сообщение уже записано — повтор пропущен.');
  if ('error' in ins) {
    deps.log?.('bot insert failed', { error: ins.error });
    return say('Не удалось сохранить операцию. Попробуйте ещё раз или добавьте её в веб-приложении.');
  }

  const summary = describeDraft(ctx, r.draft);
  const warnings = r.warnings.map((w) => `⚠️ ${esc(w)}`);
  if (!confirm) {
    return say([`✅ Записано: ${summary}`, ...warnings].join('\n'), [[
      { text: '↩️ Отменить', callback_data: cb('x', ins.id) },
      ...(r.draft.type !== 'transfer' && r.draft.type !== 'debt_payment' ? [{ text: '🏷 Категория', callback_data: cb('cat', ins.id) }] : []),
    ]]);
  }
  const reasons = r.status === 'needs_confirmation' ? r.reasons : ['Проверьте данные, распознанные с фото.'];
  return say([`Проверьте операцию: ${summary}`, ...reasons.map((x) => `• ${esc(x)}`), ...warnings, 'Пока вы не подтвердите, она не учитывается в отчётах.'].join('\n'), [
    [{ text: '✅ Подтвердить', callback_data: cb('ok', ins.id) }, { text: '❌ Отменить', callback_data: cb('x', ins.id) }],
    ...(r.draft.type !== 'transfer' && r.draft.type !== 'debt_payment' ? [[{ text: '🏷 Другая категория', callback_data: cb('cat', ins.id) }]] : []),
  ]);
}

function categoryLabel(ctx: AppContext, id: string | null): string {
  if (!id) return 'без категории';
  const c = ctx.categories.find((x) => x.id === id);
  if (!c) return 'без категории';
  const p = c.parent_id ? ctx.categories.find((x) => x.id === c.parent_id) : null;
  return p ? `${p.name} › ${c.name}` : c.name;
}

export function describeDraft(ctx: AppContext, d: TransactionDraft): string {
  const acc = (id: string | null) => ctx.accounts.find((a) => a.id === id)?.name ?? '?';
  const money = `<b>${esc(formatMinor(d.amount, d.currency))}</b>`;
  const parts = [`${TYPE_LABELS[d.type]} ${money}`];
  if (d.type === 'transfer') parts.push(`${esc(acc(d.accountId))} → ${esc(acc(d.transferAccountId))}${d.transferAmount !== null && d.transferAmount !== d.amount ? ` (зачислено ${esc(formatMinor(d.transferAmount, ctx.accounts.find((a) => a.id === d.transferAccountId)?.currency as Currency))})` : ''}`);
  else {
    if (d.type === 'debt_payment') parts.push(`основной долг ${esc(formatMinor(d.principal ?? 0n, d.currency))}, проценты ${esc(formatMinor(d.interest ?? 0n, d.currency))}${d.fee ? `, комиссии ${esc(formatMinor(d.fee, d.currency))}` : ''}`);
    else parts.push(esc(categoryLabel(ctx, d.categoryId)));
    parts.push(esc(acc(d.accountId)));
  }
  parts.push(dateRu(d.occurredOn));
  if (d.counterparty) parts.push(esc(d.counterparty));
  if (d.fx && d.fx.baseCurrency !== d.currency) parts.push(`≈ ${esc(formatMinor(d.fx.baseAmount, d.fx.baseCurrency))} по курсу на ${d.fx.rateDate}`);
  return parts.join(' · ');
}

async function askClarification(ctx: AppContext, chatId: number, a: MessageAnalysis, clar: Clarification[], externalId: string, raw: string, deps: BotDeps) {
  const first = clar[0];
  if (!first) return deps.tg.sendMessage(chatId, 'Не хватает данных для записи. Опишите операцию подробнее.');
  const choices = (first.options ?? []).slice(0, 8).map((o) => ({ field: first.field, value: o.value, label: o.label }));
  const id = await deps.store.createPending({
    userId: ctx.userId, householdId: ctx.household.id, transactionId: null, kind: 'clarify',
    payload: { analysis: a, text: raw, question: first.question, externalId, choices },
  });
  const kb: InlineKeyboard = [];
  for (let i = 0; i < choices.length; i += 2) kb.push(choices.slice(i, i + 2).map((c, k) => ({ text: c.label, callback_data: cb('pa', id, String(i + k)) })));
  await deps.tg.sendMessage(chatId, `❓ ${esc(first.question)}${choices.length ? '' : '\nОтветьте сообщением.'}`, kb.length ? kb : undefined);
}

// ───────────────────────── callbacks ─────────────────────────

async function onCallback(q: TelegramCallback, deps: BotDeps) {
  const chatId = q.message?.chat.id;
  const msgId = q.message?.message_id;
  const userId = await deps.store.userIdByTelegram(q.from.id);
  if (!chatId || !msgId || !userId) return deps.tg.answerCallback(q.id, 'Аккаунт не привязан');
  const ctx = await deps.store.loadContext(userId);
  if (!ctx) return deps.tg.answerCallback(q.id, 'Нет бюджета');
  if (!WRITE_ROLES.includes(ctx.role)) return deps.tg.answerCallback(q.id, 'Только просмотр');

  const [action, id, idx] = parseCb(q.data);
  const own = async (txId: string): Promise<TransactionRow | null> => {
    const tx = await deps.store.getTransaction(txId, ctx.household.id);
    return tx && tx.created_by === userId ? tx : null;
  };

  if (action === 'ok' || action === 'x') {
    const tx = await own(id ?? '');
    if (!tx) return deps.tg.answerCallback(q.id, 'Операция не найдена');
    if (action === 'ok') {
      if (tx.status !== 'pending_confirmation' && tx.status !== 'draft') return deps.tg.answerCallback(q.id, 'Уже подтверждена');
      await deps.store.updateTransaction(tx.id, ctx.household.id, { status: 'confirmed' });
      await deps.tg.editMessage(chatId, msgId, `✅ Подтверждено: ${describeRow(ctx, tx)}`, [[{ text: '↩️ Отменить', callback_data: cb('x', tx.id) }]]);
      return deps.tg.answerCallback(q.id, 'Подтверждено');
    }
    if (tx.status === 'cancelled') return deps.tg.answerCallback(q.id, 'Уже отменена');
    await deps.store.updateTransaction(tx.id, ctx.household.id, { status: 'cancelled' });
    await deps.tg.editMessage(chatId, msgId, `❌ Отменено: ${describeRow(ctx, tx)}`);
    return deps.tg.answerCallback(q.id, 'Отменено');
  }

  if (action === 'cat') {
    const tx = await own(id ?? '');
    if (!tx || tx.type === 'transfer' || tx.type === 'debt_payment') return deps.tg.answerCallback(q.id, 'Нельзя изменить категорию');
    const kind = tx.type === 'income' ? 'income' : 'expense';
    const choices = ctx.categories.filter((c) => c.kind === kind && !c.parent_id).slice(0, 16).map((c) => ({ id: c.id, name: c.name }));
    const pid = await deps.store.createPending({ userId, householdId: ctx.household.id, transactionId: tx.id, kind: 'set_category', payload: { choices } });
    const kb: InlineKeyboard = [];
    for (let i = 0; i < choices.length; i += 2) kb.push(choices.slice(i, i + 2).map((c, k) => ({ text: c.name, callback_data: cb('pa', pid, String(i + k)) })));
    await deps.tg.sendMessage(chatId, 'Выберите категорию:', kb);
    return deps.tg.answerCallback(q.id);
  }

  if (action === 'pa') {
    const p = await deps.store.getPending(id ?? '', userId);
    if (!p) return deps.tg.answerCallback(q.id, 'Вопрос устарел');
    const i = Number(idx);
    await deps.store.deletePending(p.id);

    if (p.kind === 'set_category') {
      const choice = (p.payload.choices as { id: string; name: string }[])[i];
      const tx = p.transactionId ? await own(p.transactionId) : null;
      if (!choice || !tx) return deps.tg.answerCallback(q.id, 'Операция не найдена');
      await deps.store.updateTransaction(tx.id, ctx.household.id, { category_id: choice.id });
      await deps.tg.editMessage(chatId, msgId, `🏷 Категория изменена на «${esc(choice.name)}»`);
      return deps.tg.answerCallback(q.id, 'Готово');
    }

    if (p.kind === 'clarify') {
      const { analysis, externalId, text, choices } = p.payload as { analysis: MessageAnalysis; externalId: string; text: string; choices: { field: string; value: string; label: string }[] };
      const choice = choices[i];
      if (!choice) return deps.tg.answerCallback(q.id, 'Вариант не найден');
      const next = applyChoice(ctx, analysis, choice);
      await deps.tg.editMessage(chatId, msgId, `Выбрано: ${esc(choice.label)}`);
      await deps.tg.answerCallback(q.id);
      return processAnalysis(ctx, chatId, next, externalId, deps, { raw: text });
    }
  }
  return deps.tg.answerCallback(q.id, 'Неизвестное действие');
}

/** Applies a button answer to the stored analysis without another model call. */
export function applyChoice(ctx: AppContext, a: MessageAnalysis, c: { field: string; value: string }): MessageAnalysis {
  const accountName = (id: string) => ctx.accounts.find((x) => x.id === id)?.name ?? null;
  switch (c.field) {
    case 'currency':
      return { ...a, currency_raw: c.value };
    case 'account':
      return { ...a, account_hint: accountName(c.value) };
    case 'to_account':
      return { ...a, to_account_hint: accountName(c.value) };
    case 'debt':
      return { ...a, debt_hint: ctx.debts.find((d) => d.id === c.value)?.name ?? null };
    default:
      return a;
  }
}

function describeRow(ctx: AppContext, t: TransactionRow): string {
  return `${TYPE_LABELS[t.type]} <b>${esc(formatMinor(toMinor(t.amount), t.currency))}</b> · ${esc(categoryLabel(ctx, t.category_id))} · ${dateRu(t.occurred_on)}`;
}

async function showLast(ctx: AppContext, chatId: number, deps: BotDeps) {
  const t = await deps.store.lastTelegramTransaction(ctx.userId, ctx.household.id);
  if (!t) return deps.tg.sendMessage(chatId, 'Операций из Telegram пока нет.');
  const kb: InlineKeyboard = [[
    ...(t.status === 'pending_confirmation' ? [{ text: '✅ Подтвердить', callback_data: cb('ok', t.id) }] : []),
    { text: '❌ Отменить', callback_data: cb('x', t.id) },
    ...(t.type !== 'transfer' && t.type !== 'debt_payment' ? [{ text: '🏷 Категория', callback_data: cb('cat', t.id) }] : []),
  ]];
  return deps.tg.sendMessage(chatId, `Последняя операция: ${describeRow(ctx, t)}${t.status === 'pending_confirmation' ? '\n(ожидает подтверждения)' : ''}\nСумму или дату можно исправить в веб-приложении.`, kb);
}
