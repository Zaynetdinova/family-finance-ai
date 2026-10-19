import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const user = z.object({ id: z.number().int(), is_bot: z.boolean().optional(), first_name: z.string().optional(), username: z.string().optional() });
const chat = z.object({ id: z.number().int(), type: z.string() });

const message = z.object({
  message_id: z.number().int(),
  date: z.number().int(),
  from: user.optional(),
  chat,
  text: z.string().max(4096).optional(),
  caption: z.string().max(1024).optional(),
  voice: z.object({ file_id: z.string(), duration: z.number(), file_size: z.number().optional(), mime_type: z.string().optional() }).optional(),
  photo: z.array(z.object({ file_id: z.string(), width: z.number(), height: z.number(), file_size: z.number().optional() })).optional(),
});

const callbackQuery = z.object({
  id: z.string(),
  from: user,
  data: z.string().max(64).optional(),
  message: z.object({ message_id: z.number().int(), chat }).optional(),
});

/** Only the parts of a Telegram Update that the bot uses; unknown fields are ignored. */
export const updateSchema = z.object({
  update_id: z.number().int(),
  message: message.optional(),
  callback_query: callbackQuery.optional(),
});

export type TelegramUpdate = z.infer<typeof updateSchema>;
export type TelegramMessage = z.infer<typeof message>;
export type TelegramCallback = z.infer<typeof callbackQuery>;

/** Telegram sends the secret configured in setWebhook in this header; compare in constant time. */
export function verifyWebhookSecret(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
