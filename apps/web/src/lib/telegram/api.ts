export interface InlineButton {
  text: string;
  callback_data: string;
}
export type InlineKeyboard = InlineButton[][];

export interface TelegramApi {
  sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard): Promise<void>;
  editMessage(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  /** Downloads a file sent by the user (voice, photo); enforces a size limit. */
  downloadFile(fileId: string, maxBytes: number): Promise<{ data: ArrayBuffer; path: string }>;
}

export const MAX_MESSAGE = 4096;

/** Telegram limits messages to 4096 characters; split on line breaks. */
export function splitMessage(text: string, max = MAX_MESSAGE): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur.length + line.length + 1 > max) {
      if (cur) parts.push(cur);
      cur = line.length > max ? line.slice(0, max) : line;
    } else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) parts.push(cur);
  return parts;
}

/** Bot API client over fetch. The token appears only in the request URL and never in logs or errors. */
export function createTelegramApi(token: string, fetchImpl: typeof fetch = fetch): TelegramApi {
  const base = `https://api.telegram.org/bot${token}`;

  async function call(method: string, payload: Record<string, unknown>) {
    let res: Response;
    try {
      res = await fetchImpl(`${base}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error(`Telegram ${method}: network error`);
    }
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; description?: string } | null;
    if (!res.ok || !body?.ok) throw new Error(`Telegram ${method}: ${body?.description ?? `HTTP ${res.status}`}`);
    return body.result;
  }

  return {
    async sendMessage(chatId, text, keyboard) {
      const parts = splitMessage(text);
      for (const [i, part] of parts.entries()) {
        await call('sendMessage', {
          chat_id: chatId,
          text: part,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...(keyboard && i === parts.length - 1 ? { reply_markup: { inline_keyboard: keyboard } } : {}),
        });
      }
    },
    async editMessage(chatId, messageId, text, keyboard) {
      await call('editMessageText', {
        chat_id: chatId, message_id: messageId, text: text.slice(0, MAX_MESSAGE), parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard ?? [] },
      });
    },
    async answerCallback(callbackId, text) {
      await call('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) });
    },
    async downloadFile(fileId, maxBytes) {
      const file = (await call('getFile', { file_id: fileId })) as { file_path?: string; file_size?: number };
      if (!file.file_path) throw new Error('Telegram getFile: no file path');
      if (file.file_size && file.file_size > maxBytes) throw new Error('FILE_TOO_LARGE');
      let res: Response;
      try {
        res = await fetchImpl(`https://api.telegram.org/file/bot${token}/${file.file_path}`, { signal: AbortSignal.timeout(30_000) });
      } catch {
        throw new Error('Telegram file download: network error');
      }
      if (!res.ok) throw new Error(`Telegram file download: HTTP ${res.status}`);
      const data = await res.arrayBuffer();
      if (data.byteLength > maxBytes) throw new Error('FILE_TOO_LARGE');
      return { data, path: file.file_path };
    },
  };
}
