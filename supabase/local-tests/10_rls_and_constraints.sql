-- RLS and constraint tests. Run against a database that has the stub + all migrations applied:
--   psql -v ON_ERROR_STOP=1 -d fin -f supabase/local-tests/10_rls_and_constraints.sql
-- Everything runs inside a transaction that is rolled back. Any failed assertion raises an exception.
begin;

create schema t;
create function t.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  execute 'set local role authenticated';
end $$;
create function t.as_server() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;
create function t.eq(label text, actual bigint, expected bigint) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok   %', label;
end $$;
-- Run a statement and require that it fails (optionally with a message fragment).
create function t.fails(label text, stmt text, frag text default null) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if frag is not null and position(frag in sqlerrm) = 0 then
      raise exception 'FAIL %: wrong error: %', label, sqlerrm;
    end if;
    raise notice 'ok   % (%)', label, left(sqlerrm, 60);
    return;
  end;
  raise exception 'FAIL %: statement succeeded but should have failed', label;
end $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

-- fixtures (as server)
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'alice@test'),
  ('b0000000-0000-0000-0000-000000000002', 'bob@test'),
  ('c0000000-0000-0000-0000-000000000003', 'carol@test'),
  ('d0000000-0000-0000-0000-000000000004', 'dave@test');
select t.eq('signup trigger created profiles', (select count(*) from profiles), 4);
select t.eq('signup trigger created notification prefs', (select count(*) from notification_preferences), 4);
update profiles set display_name = initcap(split_part(display_name, '@', 1));
insert into households (id, name, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'Alice family', 'a0000000-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', 'Carol solo',   'c0000000-0000-0000-0000-000000000003');
insert into household_members values
  ('11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-000000000002', 'member'),
  ('11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-000000000004', 'viewer');
insert into accounts (id, household_id, name, currency) values
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Card RUB', 'RUB'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Savings RUB', 'RUB'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'USD cash', 'USD'),
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Carol card', 'RUB');
insert into transactions (id, household_id, created_by, type, amount, currency, account_id, occurred_on)
values ('e1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'a0000000-0000-0000-0000-000000000001', 'expense', 100, 'RUB',
        'a1000000-0000-0000-0000-000000000001', '2026-01-10'),
       ('e2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
        'c0000000-0000-0000-0000-000000000003', 'expense', 999, 'RUB',
        'a2000000-0000-0000-0000-000000000001', '2026-01-10');

select t.eq('owner row created by trigger',
  (select count(*) from household_members where household_id = '11111111-1111-1111-1111-111111111111' and role = 'owner'), 1);

-- ── isolation between households ──
select t.as_user('c0000000-0000-0000-0000-000000000003');
select t.eq('carol sees only her own transactions', (select count(*) from transactions), 1);
select t.eq('carol cannot see alice household', (select count(*) from households where id = '11111111-1111-1111-1111-111111111111'), 0);
select t.eq('carol cannot see alice accounts', (select count(*) from accounts where household_id = '11111111-1111-1111-1111-111111111111'), 0);
select t.fails('carol cannot insert into alice household',
  $$insert into transactions (household_id, created_by, type, amount, currency, account_id, occurred_on)
    values ('11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000003','expense',1,'RUB','a1000000-0000-0000-0000-000000000001','2026-01-11')$$,
  'row-level security');
with u as (update transactions set amount = 1 where id = 'e1000000-0000-0000-0000-000000000001' returning 1)
  select t.eq('carol cannot update alice transaction', (select count(*) from u), 0);
with d as (delete from transactions where id = 'e1000000-0000-0000-0000-000000000001' returning 1)
  select t.eq('carol cannot delete alice transaction', (select count(*) from d), 0);
select t.as_server();
select t.eq('alice transaction still intact', (select amount::bigint from transactions where id = 'e1000000-0000-0000-0000-000000000001'), 100);

-- ── roles inside a household ──
select t.as_user('b0000000-0000-0000-0000-000000000002');   -- member
select t.eq('bob (member) sees household transactions', (select count(*) from transactions), 1);
insert into transactions (household_id, created_by, type, amount, currency, account_id, occurred_on)
  values ('11111111-1111-1111-1111-111111111111','b0000000-0000-0000-0000-000000000002','expense',50,'RUB','a1000000-0000-0000-0000-000000000001','2026-01-11');
select t.eq('member can insert', (select count(*) from transactions where created_by = 'b0000000-0000-0000-0000-000000000002'), 1);
select t.fails('bob cannot forge created_by',
  $$insert into transactions (household_id, created_by, type, amount, currency, account_id, occurred_on)
    values ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','expense',1,'RUB','a1000000-0000-0000-0000-000000000001','2026-01-11')$$,
  'row-level security');
select t.fails('member cannot add members',
  $$insert into household_members values ('11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000003','member')$$,
  'row-level security');

select t.as_user('d0000000-0000-0000-0000-000000000004');   -- viewer
select t.eq('dave (viewer) can read', (select count(*) from transactions), 2);
select t.fails('viewer cannot insert',
  $$insert into transactions (household_id, created_by, type, amount, currency, account_id, occurred_on)
    values ('11111111-1111-1111-1111-111111111111','d0000000-0000-0000-0000-000000000004','expense',1,'RUB','a1000000-0000-0000-0000-000000000001','2026-01-11')$$,
  'row-level security');
with u as (update transactions set amount = 1 returning 1) select t.eq('viewer cannot update', (select count(*) from u), 0);
with d as (delete from transactions returning 1) select t.eq('viewer cannot delete', (select count(*) from d), 0);

-- ── server-only tables and protected columns ──
select t.as_user('a0000000-0000-0000-0000-000000000001');
select t.fails('client cannot write exchange_rates',
  $$insert into exchange_rates (base_currency, quote_currency, rate, rate_date, source) values ('USD','RUB',90,'2026-01-01','x')$$,
  'row-level security');
select t.fails('client cannot write ai_interactions',
  $$insert into ai_interactions (user_id, channel, kind) values ('a0000000-0000-0000-0000-000000000001','web','x')$$,
  'row-level security');
select t.fails('client cannot set telegram_user_id',
  $$update profiles set telegram_user_id = 42 where id = 'a0000000-0000-0000-0000-000000000001'$$,
  'only be changed by the server');
select t.as_server();
insert into telegram_updates (update_id) values (1);
insert into pending_actions (user_id, household_id, kind) values ('a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','x');
select t.as_user('a0000000-0000-0000-0000-000000000001');
select t.eq('client cannot read telegram_updates', (select count(*) from telegram_updates), 0);
select t.eq('client cannot read pending_actions', (select count(*) from pending_actions), 0);
select t.eq('client cannot read link codes', (select count(*) from telegram_link_codes), 0);
select t.fails('client cannot write system categories',
  $$insert into categories (name, kind, is_system) values ('Hack','expense',true)$$, 'row-level security');
select t.eq('system categories readable', (select count(*) from categories where is_system and household_id is null), 30);

-- ── DB-level money integrity (as server) ──
select t.as_server();
select t.fails('transfer to same account rejected',
  $$insert into transactions (household_id, created_by, type, amount, currency, account_id, transfer_account_id, occurred_on)
    values ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','transfer',10,'RUB','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','2026-01-12')$$,
  'transfer_shape');
select t.fails('cross-household account reference rejected',
  $$insert into transactions (household_id, created_by, type, amount, currency, account_id, occurred_on)
    values ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','expense',10,'RUB','a2000000-0000-0000-0000-000000000001','2026-01-12')$$,
  'foreign key');
select t.fails('currency must match account currency',
  $$insert into transactions (household_id, created_by, type, amount, currency, account_id, occurred_on)
    values ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','expense',10,'USD','a1000000-0000-0000-0000-000000000001','2026-01-12')$$,
  'differs from account currency');
select t.fails('zero amount rejected',
  $$insert into transactions (household_id, created_by, type, amount, currency, account_id, occurred_on)
    values ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','expense',0,'RUB','a1000000-0000-0000-0000-000000000001','2026-01-12')$$,
  'amount');
select t.fails('cross-currency transfer needs transfer_amount',
  $$insert into transactions (household_id, created_by, type, amount, currency, account_id, transfer_account_id, occurred_on)
    values ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','transfer',9000,'RUB','a1000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000003','2026-01-12')$$,
  'transfer_amount');
select t.fails('incomplete FX snapshot rejected',
  $$insert into transactions (household_id, created_by, type, amount, currency, account_id, occurred_on, fx_rate)
    values ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','expense',10,'RUB','a1000000-0000-0000-0000-000000000001','2026-01-12', 1)$$,
  'fx_snapshot_complete');

-- duplicates
insert into transactions (household_id, created_by, type, amount, currency, account_id, occurred_on, source, external_message_id)
  values ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','expense',10,'RUB','a1000000-0000-0000-0000-000000000001','2026-01-12','telegram','tg:555:1');
select t.fails('duplicate telegram message rejected',
  $$insert into transactions (household_id, created_by, type, amount, currency, account_id, occurred_on, source, external_message_id)
    values ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','expense',10,'RUB','a1000000-0000-0000-0000-000000000001','2026-01-12','telegram','tg:555:1')$$,
  'transactions_external_unique');

-- ── debt payment: principal/interest split and balance sync ──
insert into debts (id, household_id, name, currency, original_amount, current_balance, interest_rate)
  values ('de000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Car loan','RUB',100000,100000,12);
select t.fails('debt payment split must sum to amount',
  $$insert into transactions (household_id, created_by, type, amount, currency, account_id, occurred_on, debt_id, principal_amount, interest_amount)
    values ('11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','debt_payment',10000,'RUB','a1000000-0000-0000-0000-000000000001','2026-01-15','de000000-0000-0000-0000-000000000001',5000,4000)$$,
  'debt_payment_shape');
insert into transactions (id, household_id, created_by, type, amount, currency, account_id, occurred_on, debt_id, principal_amount, interest_amount)
  values ('e1000000-0000-0000-0000-0000000000d1','11111111-1111-1111-1111-111111111111','a0000000-0000-0000-0000-000000000001','debt_payment',10000,'RUB','a1000000-0000-0000-0000-000000000001','2026-01-15','de000000-0000-0000-0000-000000000001',6000,4000);
select t.eq('debt balance reduced by principal only', (select current_balance::bigint from debts where id = 'de000000-0000-0000-0000-000000000001'), 94000);
select t.eq('debt_payments row created', (select count(*) from debt_payments where interest = 4000 and principal = 6000), 1);
update transactions set status = 'cancelled' where id = 'e1000000-0000-0000-0000-0000000000d1';
select t.eq('cancelling payment restores balance', (select current_balance::bigint from debts where id = 'de000000-0000-0000-0000-000000000001'), 100000);
select t.eq('cancelling payment removes debt_payments row', (select count(*) from debt_payments), 0);

rollback;
