# Family Finance AI

Приложение для учёта личных и семейных финансов с AI-агентом в Telegram и веб-дашбордом.

Стек: Next.js, TypeScript, Tailwind CSS, shadcn/ui, Supabase (PostgreSQL, Auth, RLS), n8n, OpenAI, Recharts, Zod, Vitest.

## Структура

- `apps/web` — веб-приложение и серверные API
- `supabase/migrations` — SQL-миграции и RLS
- `n8n` — экспорт workflow (без секретов)
- `docs` — архитектура и план

## Статус

Этап 1 (аудит и архитектура): репозиторий создан, код ещё не написан.
Подробности в `docs/PLAN.md`.
