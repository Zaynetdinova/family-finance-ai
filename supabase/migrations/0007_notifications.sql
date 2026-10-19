-- 0007_notifications.sql
-- Idempotency log for scheduled messages (summaries, payment reminders, budget alerts).
-- A row is claimed BEFORE sending; the unique key guarantees one message per user, kind and
-- period even if the scheduler fires twice. Failed sends release the claim so the next run retries.

create table notifications_sent (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles (id) on delete cascade,
  kind        text not null,       -- daily | weekly | monthly | payment | budget
  dedupe_key  text not null,       -- e.g. 'weekly:2026-W42', 'payment:<debt>:2026-10-25'
  status      text not null default 'claimed' check (status in ('claimed', 'sent')),
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  unique (user_id, dedupe_key)
);
create index notifications_sent_user_idx on notifications_sent (user_id, created_at desc);

alter table notifications_sent enable row level security;
-- Users may see what was sent to them; only the server writes.
create policy notifications_sent_select on notifications_sent for select to authenticated
  using (user_id = auth.uid());

-- scheduled_reports: one row per user/household/kind already exists in 0001; defaults live in code.
