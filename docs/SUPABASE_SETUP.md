# Подключение Supabase

Проект: `ateuomwqiswhpqpadjza` (https://supabase.com/dashboard/project/ateuomwqiswhpqpadjza).

## 1. Привязать CLI и применить миграции (на вашем компьютере)

```bash
npm i -g supabase            # или: npx supabase <команда>
supabase login               # откроет браузер
supabase link --project-ref ateuomwqiswhpqpadjza   # спросит пароль БД
supabase db push             # применит supabase/migrations/0001…0007
```

Пароль БД (Project Settings → Database) вводится только в терминале. Не вставляйте его в чат, в коммиты и в `.env.example`.
`supabase link` также синхронизирует версию PostgreSQL в `supabase/config.toml`.

Файлы из `supabase/local-tests/` на Supabase **не применяются**: это заглушка и тесты для локального PostgreSQL.

После добавления новых миграций повторите `supabase db push` (`0005` — приглашения в семейный бюджет, `0006` — счета по умолчанию для Telegram, `0007` — журнал отправленных уведомлений).

## 2. Ключи

В `apps/web/.env.local` (в git не попадает):

- `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — публичные, можно использовать в браузере.
- `CRON_SECRET` — любой случайный секрет ≥ 16 символов для вызова `/api/fx/refresh` планировщиком.
- `SUPABASE_SECRET_KEY` (Project Settings → API Keys → Secret key) нужен только серверным обработчикам (Telegram webhook, n8n, импорт курсов). Он обходит RLS: никогда не передавать в клиентский код.

## 3. Настройки Auth

Authentication → URL Configuration: указать Site URL веб-приложения и Redirect URLs. Включить нужные способы входа (email/пароль или magic link).

## 4. Проверка после `db push`

1. Table Editor: таблицы созданы, у всех включён RLS.
2. В `categories` 30 системных строк с `household_id = null`.
3. После регистрации тестового пользователя в `profiles` появляется его строка (триггер `on_auth_user_created`).
4. Запрос с publishable-ключом без входа к `transactions` возвращает пустой список.

Пока эти шаги не выполнены, интеграция с реальным проектом **не проверена**.
