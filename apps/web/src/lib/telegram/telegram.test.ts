import { describe, expect, it } from 'vitest';
import { createTelegramApi, splitMessage } from './api';
import { updateSchema, verifyWebhookSecret } from './update';
import { cb, esc, parseCb } from './format';

describe('webhook secret', () => {
  it('accepts only the exact configured secret', () => {
    const s = 'a'.repeat(32);
    expect(verifyWebhookSecret(s, s)).toBe(true);
    expect(verifyWebhookSecret('b'.repeat(32), s)).toBe(false);
    expect(verifyWebhookSecret(null, s)).toBe(false);
    expect(verifyWebhookSecret(s, undefined)).toBe(false);
    expect(verifyWebhookSecret('short', 'short')).toBe(false); // too weak secret is never accepted
  });
});

describe('update parsing', () => {
  it('parses messages and callbacks and ignores unknown fields', () => {
    const u = updateSchema.parse({ update_id: 1, message: { message_id: 5, date: 1, chat: { id: 9, type: 'private' }, from: { id: 9, first_name: 'A' }, text: 'hi', entities: [] }, foo: 1 });
    expect(u.message?.text).toBe('hi');
    expect(updateSchema.safeParse({ update_id: 'x' }).success).toBe(false);
  });
});

describe('format', () => {
  it('escapes HTML in user content', () => {
    expect(esc('<b>Магнит & Ко</b>')).toBe('&lt;b&gt;Магнит &amp; Ко&lt;/b&gt;');
  });
  it('enforces the 64-byte callback limit', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parseCb(cb('pa', id, '3'))).toEqual(['pa', id, '3']);
    expect(() => cb('pa', id, id)).toThrow();
  });
  it('splits long messages on line boundaries', () => {
    const parts = splitMessage(Array.from({ length: 300 }, (_, i) => `строка ${i} ${'x'.repeat(20)}`).join('\n'), 1000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
    expect(parts.join('\n').split('\n')).toHaveLength(300);
  });
});

describe('telegram api client', () => {
  it('sends HTML messages with keyboards and surfaces API errors without the token', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const api = createTelegramApi('123:SECRET', async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init!.body)) });
      return Response.json({ ok: true, result: {} });
    });
    await api.sendMessage(1, 'hi', [[{ text: 'OK', callback_data: 'ok' }]]);
    expect(calls[0]!.body).toMatchObject({ chat_id: 1, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'OK', callback_data: 'ok' }]] } });

    const failing = createTelegramApi('123:SECRET', async () => Response.json({ ok: false, description: 'Bad Request: chat not found' }, { status: 400 }));
    await expect(failing.sendMessage(1, 'x')).rejects.toThrow('Telegram sendMessage: Bad Request: chat not found');
    await failing.sendMessage(1, 'x').catch((e: Error) => expect(e.message).not.toContain('SECRET'));
  });
  it('refuses files above the size limit', async () => {
    const api = createTelegramApi('t', async () => Response.json({ ok: true, result: { file_path: 'voice/1.oga', file_size: 50_000_000 } }));
    await expect(api.downloadFile('f', 10_000_000)).rejects.toThrow('FILE_TOO_LARGE');
  });
});
