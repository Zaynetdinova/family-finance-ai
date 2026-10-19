# Деплой (Vercel)

Бот и регулярные сводки работают постоянно только на сервере с публичным HTTPS-адресом. Ниже — Vercel (бесплатного тарифа достаточно); подойдёт любой хостинг Next.js.

1. **Импорт проекта**: vercel.com → Add New → Project → репозиторий `family-finance-ai`.
   - **Root Directory**: `apps/web`
   - Framework: Next.js (определится сам). Build command и output — по умолчанию.
2. **Environment Variables** (Production): все из `.env.example`:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_TRANSCRIPTION_MODEL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`, `APP_URL` (= адрес Vercel, например `https://family-finance.vercel.app`).
3. **Deploy**. Откройте адрес — должна открыться страница входа.
4. **Supabase Auth** → URL Configuration: Site URL = адрес приложения; Redirect URLs — добавить `https://<адрес>/auth/callback`.
5. **Миграции** (если ещё не применены): `npx supabase db push` (до `0007_notifications.sql`).
6. **Telegram webhook** (на своём компьютере, в `apps/web`; локальный `npm run telegram:poll` перед этим остановите):
   ```bash
   set -a; source .env.local; set +a
   APP_URL=https://<адрес> npm run telegram:webhook set
   npm run telegram:webhook info     # url = https://<адрес>/api/telegram/webhook, last_error_message пусто
   ```
   После этого бот работает без вашего компьютера. Чтобы снова тестировать локально: `npm run telegram:webhook delete` и `npm run telegram:poll`.
7. **Расписание**: n8n или cron-job.org по `docs/N8N.md` (почасовой `/api/jobs/tick`). Курсы раз в день уже запускает Vercel Cron из `vercel.json`.
8. **Проверка**: напишите боту операцию; `curl -X POST https://<адрес>/api/jobs/tick -H "Authorization: Bearer $CRON_SECRET"` → `"ok": true`.

Логи: Vercel → Project → Logs (ошибки бота с префиксом `[telegram]`, задач — `[jobs]`; ключи и тексты сообщений туда не пишутся).
