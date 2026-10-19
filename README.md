# Family Finance AI

Приложение для учёта личных и семейных финансов с AI-агентом в Telegram и веб-дашбордом.

Стек: Next.js, TypeScript, Tailwind CSS, shadcn/ui, Supabase (PostgreSQL, Auth, RLS), n8n, OpenAI, Recharts, Zod, Vitest.

## Структура

- `apps/web` — веб-приложение и серверные API
- `supabase/migrations` — SQL-миграции и RLS
- `n8n` — экспорт workflow (без секретов)
- `docs` — архитектура и план

## Статус

| Этап | Состояние |
|---|---|
| 1. Аудит и архитектура | готов |
| 2. Финансовое ядро | готов: схема БД, RLS, расчёты, валюты, тесты |
| 3. Веб-приложение | готово, проверено на реальном Supabase |
| 4. AI и Telegram | готов, проверен вживую (бот в режиме опроса) |
| 5. Долги и прогнозы | готов: лавина, снежный ком, сценарии (`docs/DEBTS.md`) |
| 6. Автоматизация | готов в коде и тестах: почасовые сводки и напоминания, n8n-workflow, деплой. Живой запуск по расписанию требует деплоя и планировщика |

## Документация

| Файл | О чём |
|---|---|
| `docs/SUPABASE_SETUP.md` | миграции, ключи, Auth |
| `docs/WEB.md` | запуск веб-приложения, страницы |
| `docs/TELEGRAM.md` | бот, AI, локальная проверка |
| `docs/DEBTS.md` | план погашения долгов |
| `docs/N8N.md` | регулярные задачи, n8n, эндпоинты |
| `docs/DEPLOY.md` | деплой на Vercel, webhook |
| `docs/SECURITY.md` | модель безопасности |
| `docs/ACCOUNTING.md` | правила учёта и валют |

## Быстрый старт (локально)

```bash
npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push
cd apps/web
cp ../../.env.example .env.local   # заполнить
npm install
npm run dev                        # http://localhost:3000
# бот без публичного адреса (второй терминал):
set -a; source .env.local; set +a; npm run telegram:webhook delete; npm run telegram:poll
```

## Внешние сервисы (подключаются вручную)

| Сервис | Зачем | Что нужно |
|---|---|---|
| Supabase | база, авторизация | проект, `db push`, URL и ключи, Redirect URL `/auth/callback` |
| OpenAI | разбор сообщений, голос, чеки, текст отчётов | `OPENAI_API_KEY` (модель — `OPENAI_MODEL`) |
| Telegram | бот | токен от @BotFather, имя бота, `TELEGRAM_WEBHOOK_SECRET`; webhook после деплоя |
| Хостинг (Vercel) | постоянная работа бота и задач | проект с Root Directory `apps/web`, переменные окружения |
| n8n или cron-job.org | почасовые сводки и напоминания | вызов `/api/jobs/tick` с `CRON_SECRET` |
| open.er-api.com | курсы валют | ключ не нужен; ARS — официальный курс, «блю» вводится вручную |

## Проверка

```bash
cd apps/web && npm run typecheck && npm run lint && npm test && npm run build
PSQL_ARGS="-h localhost -U postgres" supabase/local-tests/run.sh   # SQL/RLS-тесты на локальном PostgreSQL 15+
```

`supabase/local-tests/00_supabase_stub.sql` имитирует объекты Supabase только для локального теста; на Supabase не применяется.
