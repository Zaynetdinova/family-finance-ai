#!/usr/bin/env node
// Local development without a public URL: long-polls Telegram and forwards each update to the
// local webhook with the secret header, exactly as Telegram would. Requires the webhook to be
// deleted (Telegram does not allow getUpdates while a webhook is set).
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-poll.mjs [http://localhost:3000]
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const target = `${(process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '')}/api/telegram/webhook`;
if (!token || !secret) { console.error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET'); process.exit(1); }

const api = (m, body) => fetch(`https://api.telegram.org/bot${token}/${m}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
}).then((r) => r.json());

const info = await api('getWebhookInfo');
if (info.result?.url) { console.error('A webhook is set. Remove it first: npm run telegram:webhook delete'); process.exit(1); }

console.log(`Polling Telegram, forwarding to ${target}. Ctrl+C to stop.`);
let offset = 0;
for (;;) {
  let res;
  try {
    res = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
  } catch (e) {
    console.error('getUpdates failed:', e.message); await new Promise((r) => setTimeout(r, 3000)); continue;
  }
  for (const update of res.result ?? []) {
    offset = update.update_id + 1;
    try {
      const r = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify(update) });
      console.log(`update ${update.update_id} → ${r.status}`);
    } catch (e) {
      console.error(`update ${update.update_id} → local app unreachable: ${e.message}`);
    }
  }
}
