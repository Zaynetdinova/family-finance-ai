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
| 1. Аудит и архитектура | готов (репозиторий был пуст) |
| 2. Финансовое ядро | готов: схема БД, RLS, расчёты, тесты |
| 3. Веб-приложение | готово к проверке на реальном Supabase: Next.js, вход, обзор, операции, аналитика, долги, бюджеты и цели, настройки |
| 4. AI и Telegram | не начат (готовы схема ответа модели и нормализация) |
| 5. Долги и прогнозы | не начат (поля и триггеры в БД есть, стратегии погашения не реализованы) |
| 6. n8n и документация | не начат |

Внешние сервисы (Supabase, OpenAI, Telegram, n8n, источник курсов) пока **не подключены и не проверялись**.

## Проверка

```bash
# TypeScript-ядро и веб-приложение
cd apps/web && npm install && npm run typecheck && npm run lint && npm test && npm run build

# SQL-миграции, RLS и ограничения (нужен PostgreSQL 15+ и право создавать БД)
PSQL_ARGS="-h localhost -U postgres" supabase/local-tests/run.sh
```

`supabase/local-tests/00_supabase_stub.sql` имитирует объекты Supabase (`auth.users`, `auth.uid()`, роли) только для локального теста на обычном PostgreSQL; на настоящем Supabase он не применяется.

## Миграции на Supabase

Применить по порядку файлы из `supabase/migrations` (SQL Editor или `supabase db push`): `0001_schema.sql` … `0005_household_invites.sql`.

Привилегированные операции (запись курсов, журнал AI, Telegram-привязка, идемпотентность webhook) выполняются только ключом `service_role` на сервере.

Подключение Supabase: `docs/SUPABASE_SETUP.md`. Запуск веб-приложения: `docs/WEB.md`. Правила учёта: `docs/ACCOUNTING.md`. План: `docs/PLAN.md`.
