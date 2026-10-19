#!/usr/bin/env node
// Registers (or removes) the Telegram webhook. Reads secrets from the environment only.
//   APP_URL=https://your-app.example TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-webhook.mjs set
//   TELEGRAM_BOT_TOKEN=... node scripts/telegram-webhook.mjs info|delete
const [, , cmd = 'info'] = process.argv;
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) { console.error('TELEGRAM_BOT_TOKEN is not set'); process.exit(1); }
const api = (m, body) => fetch(`https://api.telegram.org/bot${token}/${m}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
}).then((r) => r.json());

if (cmd === 'set') {
  const url = process.env.APP_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!url?.startsWith('https://')) { console.error('APP_URL must be a public https:// URL'); process.exit(1); }
  if (!secret || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) { console.error('TELEGRAM_WEBHOOK_SECRET must be 16-256 chars of A-Z a-z 0-9 _ -'); process.exit(1); }
  const r = await api('setWebhook', {
    url: `${url.replace(/\/$/, '')}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: false,
    max_connections: 10,
  });
  console.log(r.ok ? 'Webhook set' : `Failed: ${r.description}`);
  const cmds = await api('setMyCommands', { commands: [
    ['today', 'Сводка за день'], ['week', 'Сводка за неделю'], ['month', 'Отчёт за месяц'], ['analytics', 'Основные выводы'],
    ['debts', 'Долги и платежи'], ['budget', 'Состояние бюджета'], ['goals', 'Финансовые цели'], ['last', 'Последняя операция'],
    ['help', 'Возможности'],
  ].map(([command, description]) => ({ command, description })) });
  console.log(cmds.ok ? 'Commands set' : `Commands failed: ${cmds.description}`);
} else if (cmd === 'delete') {
  console.log(await api('deleteWebhook', { drop_pending_updates: false }));
} else {
  const r = await api('getWebhookInfo');
  if (r.result) delete r.result.ip_address;
  console.log(r);
}
