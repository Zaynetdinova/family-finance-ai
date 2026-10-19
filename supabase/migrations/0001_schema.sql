-- 0001_schema.sql
-- Core schema for the family finance app.
-- Money: numeric(20,2) only, never floating point. FX rates: numeric(20,10).
-- All three supported currencies (RUB, USD, ARS) use 2 decimal places.

create extension if not exists pgcrypto;

-- ───────────────────────── enums ─────────────────────────
create type currency_code     as enum ('RUB', 'USD', 'ARS');
create type household_role    as enum ('owner', 'admin', 'member', 'viewer');
create type account_type      as enum ('cash', 'card', 'savings', 'credit', 'investment', 'other');
create type category_kind     as enum ('income', 'expense');
create type transaction_type  as enum ('income', 'expense', 'transfer', 'debt_payment', 'refund');
create type transaction_status as enum ('draft', 'pending_confirmation', 'confirmed', 'cancelled');
create type data_source       as enum ('telegram', 'web', 'manual', 'import');
create type debt_direction    as enum ('owed_by_me', 'owed_to_me');
create type debt_kind         as enum ('loan', 'mortgage', 'credit_card', 'personal', 'other');
create type rate_type         as enum ('fixed', 'variable');
create type debt_status       as enum ('active', 'closed');
create type goal_status       as enum ('active', 'achieved', 'paused', 'cancelled');
create type report_kind       as enum ('daily', 'weekly', 'monthly');

-- ───────────────────────── helpers ─────────────────────────
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ───────────────────────── profiles ─────────────────────────
create table profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  display_name      text,
  base_currency     currency_code not null default 'RUB',
  timezone          text not null default 'UTC',
  locale            text not null default 'ru',
  telegram_user_id  bigint unique,
  telegram_chat_id  bigint,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger profiles_updated before update on profiles
  for each row execute function set_updated_at();

-- One-time codes used to link a Telegram user to an authenticated app account.
-- Only the SHA-256 hash of the code is stored.
create table telegram_link_codes (
  code_hash   text primary key,
  user_id     uuid not null references profiles (id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index telegram_link_codes_user_idx on telegram_link_codes (user_id);

-- ───────────────────────── households ─────────────────────────
create table households (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) > 0),
  base_currency  currency_code not null default 'RUB',
  created_by     uuid not null references profiles (id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger households_updated before update on households
  for each row execute function set_updated_at();

create table household_members (
  household_id  uuid not null references households (id) on delete cascade,
  user_id       uuid not null references profiles (id) on delete cascade,
  role          household_role not null default 'member',
  created_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on household_members (user_id);

-- The creator of a household automatically becomes its owner.
create or replace function add_household_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into household_members (household_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end $$;
create trigger households_add_owner after insert on households
  for each row execute function add_household_owner();

-- ───────────────────────── accounts ─────────────────────────
create table accounts (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references households (id) on delete cascade,
  owner_id         uuid references profiles (id) on delete set null,
  name             text not null check (length(trim(name)) > 0),
  type             account_type not null default 'card',
  currency         currency_code not null,
  opening_balance  numeric(20,2) not null default 0,
  is_archived      boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, name)
);
create trigger accounts_updated before update on accounts
  for each row execute function set_updated_at();

-- ───────────────────────── categories ─────────────────────────
-- household_id IS NULL → system category visible to everyone.
create table categories (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references households (id) on delete cascade,
  parent_id     uuid references categories (id) on delete cascade,
  name          text not null check (length(trim(name)) > 0),
  kind          category_kind not null,
  is_fixed      boolean not null default false,   -- fixed vs variable expense
  is_system     boolean not null default false,
  created_at    timestamptz not null default now(),
  check (is_system = (household_id is null))
);
create unique index categories_unique_name on categories
  (coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(parent_id,    '00000000-0000-0000-0000-000000000000'::uuid),
   kind, lower(name));
create index categories_household_idx on categories (household_id);

-- ───────────────────────── exchange rates ─────────────────────────
-- rate: 1 unit of base_currency = rate units of quote_currency.
create table exchange_rates (
  id              uuid primary key default gen_random_uuid(),
  base_currency   currency_code not null,
  quote_currency  currency_code not null,
  rate            numeric(20,10) not null check (rate > 0),
  rate_date       date not null,
  source          text not null,
  fetched_at      timestamptz not null default now(),
  check (base_currency <> quote_currency),
  unique (base_currency, quote_currency, rate_date, source)
);
create index exchange_rates_lookup_idx on exchange_rates (base_currency, quote_currency, rate_date desc);

-- ───────────────────────── debts ─────────────────────────
create table debts (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references households (id) on delete cascade,
  direction         debt_direction not null default 'owed_by_me',
  kind              debt_kind not null default 'loan',
  name              text not null check (length(trim(name)) > 0),
  counterparty      text,
  currency          currency_code not null,
  original_amount   numeric(20,2) not null check (original_amount >= 0),
  current_balance   numeric(20,2) not null check (current_balance >= 0),
  interest_rate     numeric(7,4) check (interest_rate is null or interest_rate >= 0), -- annual %
  rate_type         rate_type not null default 'fixed',
  min_payment       numeric(20,2) check (min_payment is null or min_payment >= 0),
  payment_day       smallint check (payment_day between 1 and 31),
  opened_on         date,
  due_date          date,                    -- final maturity
  allows_prepayment boolean not null default true,
  prepayment_fee_pct numeric(7,4) check (prepayment_fee_pct is null or prepayment_fee_pct >= 0),
  priority          boolean not null default false,
  status            debt_status not null default 'active',
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, household_id)
);
create index debts_household_idx on debts (household_id, status);
create trigger debts_updated before update on debts
  for each row execute function set_updated_at();

-- ───────────────────────── transactions ─────────────────────────
create table transactions (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references households (id) on delete cascade,
  created_by           uuid not null references profiles (id) on delete restrict,
  type                 transaction_type not null,
  status               transaction_status not null default 'confirmed',

  -- original amount, never rewritten
  amount               numeric(20,2) not null check (amount > 0),
  currency             currency_code not null,

  account_id           uuid not null,
  -- transfers only: destination account and the amount credited there
  transfer_account_id  uuid,
  transfer_amount      numeric(20,2) check (transfer_amount is null or transfer_amount > 0),

  category_id          uuid references categories (id) on delete set null,
  occurred_on          date not null,
  counterparty         text,
  comment              text,

  -- FX snapshot taken when the operation is saved; later rate changes never touch it
  base_currency        currency_code,
  fx_rate              numeric(20,10) check (fx_rate is null or fx_rate > 0),  -- 1 unit currency = fx_rate base units
  fx_rate_date         date,
  fx_rate_source       text,
  base_amount          numeric(20,2),

  -- debt payments
  debt_id              uuid,
  principal_amount     numeric(20,2) check (principal_amount is null or principal_amount >= 0),
  interest_amount      numeric(20,2) check (interest_amount is null or interest_amount >= 0),
  fee_amount           numeric(20,2) check (fee_amount is null or fee_amount >= 0),

  refund_of_id         uuid references transactions (id) on delete set null,

  source               data_source not null default 'web',
  raw_message          text,
  external_message_id  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  foreign key (account_id, household_id)
    references accounts (id, household_id) on delete restrict,
  foreign key (transfer_account_id, household_id)
    references accounts (id, household_id) on delete restrict,
  foreign key (debt_id, household_id)
    references debts (id, household_id) on delete restrict,

  -- transfers need a distinct destination; other types must not have one
  constraint transfer_shape check (
    (type = 'transfer' and transfer_account_id is not null and transfer_account_id <> account_id)
    or (type <> 'transfer' and transfer_account_id is null and transfer_amount is null)
  ),
  -- debt payments must reference a debt and split exactly into principal + interest + fee
  constraint debt_payment_shape check (
    (type = 'debt_payment'
       and debt_id is not null
       and principal_amount is not null
       and principal_amount + coalesce(interest_amount, 0) + coalesce(fee_amount, 0) = amount)
    or (type <> 'debt_payment'
       and principal_amount is null and interest_amount is null and fee_amount is null)
  ),
  -- FX snapshot is all-or-nothing
  constraint fx_snapshot_complete check (
    (base_currency is null and fx_rate is null and fx_rate_date is null and base_amount is null)
    or (base_currency is not null and fx_rate is not null and fx_rate_date is not null and base_amount is not null)
  ),
  constraint fx_same_currency check (base_currency is null or base_currency <> currency or fx_rate = 1)
);

-- Duplicate protection: the same external message can be stored once per household and source.
create unique index transactions_external_unique
  on transactions (household_id, source, external_message_id)
  where external_message_id is not null;
create index transactions_household_date_idx on transactions (household_id, occurred_on desc);
create index transactions_account_idx on transactions (account_id);
create index transactions_category_idx on transactions (category_id);
create index transactions_debt_idx on transactions (debt_id) where debt_id is not null;
create index transactions_status_idx on transactions (household_id, status);
create trigger transactions_updated before update on transactions
  for each row execute function set_updated_at();

-- Cross-table consistency that FKs cannot express.
create or replace function check_transaction_integrity() returns trigger
language plpgsql as $$
declare
  acc_ccy currency_code;
  dst_ccy currency_code;
  cat_household uuid;
  cat_kind category_kind;
begin
  select currency into acc_ccy from accounts where id = new.account_id;
  if acc_ccy <> new.currency and new.type <> 'transfer' then
    raise exception 'transaction currency % differs from account currency %', new.currency, acc_ccy;
  end if;

  if new.type = 'transfer' then
    select currency into dst_ccy from accounts where id = new.transfer_account_id;
    if new.currency <> acc_ccy then
      raise exception 'transfer currency must match source account currency';
    end if;
    if dst_ccy = acc_ccy then
      if new.transfer_amount is not null and new.transfer_amount <> new.amount then
        raise exception 'same-currency transfer cannot change the amount';
      end if;
    elsif new.transfer_amount is null then
      raise exception 'cross-currency transfer requires transfer_amount';
    end if;
  end if;

  if new.category_id is not null then
    select household_id, kind into cat_household, cat_kind from categories where id = new.category_id;
    if cat_household is not null and cat_household <> new.household_id then
      raise exception 'category belongs to another household';
    end if;
  end if;
  return new;
end $$;
create trigger transactions_integrity before insert or update on transactions
  for each row execute function check_transaction_integrity();

-- Payments linked to debts, derived from confirmed debt_payment transactions.
create table debt_payments (
  id              uuid primary key default gen_random_uuid(),
  debt_id         uuid not null,
  household_id    uuid not null,
  transaction_id  uuid not null unique references transactions (id) on delete cascade,
  paid_on         date not null,
  principal       numeric(20,2) not null check (principal >= 0),
  interest        numeric(20,2) not null default 0 check (interest >= 0),
  fees            numeric(20,2) not null default 0 check (fees >= 0),
  total           numeric(20,2) generated always as (principal + interest + fees) stored,
  created_at      timestamptz not null default now(),
  foreign key (debt_id, household_id) references debts (id, household_id) on delete cascade
);
create index debt_payments_debt_idx on debt_payments (debt_id, paid_on desc);

-- Keep debt_payments and debts.current_balance in sync with confirmed debt_payment transactions.
create or replace function sync_debt_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_principal numeric(20,2) := 0;
  new_principal numeric(20,2) := 0;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.type = 'debt_payment' and old.status = 'confirmed' then
    old_principal := old.principal_amount;
    delete from debt_payments where transaction_id = old.id;
    update debts set current_balance = current_balance + old_principal,
                     status = 'active'
      where id = old.debt_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.type = 'debt_payment' and new.status = 'confirmed' then
    new_principal := new.principal_amount;
    insert into debt_payments (debt_id, household_id, transaction_id, paid_on, principal, interest, fees)
    values (new.debt_id, new.household_id, new.id, new.occurred_on,
            new.principal_amount, coalesce(new.interest_amount, 0), coalesce(new.fee_amount, 0));
    update debts set current_balance = greatest(current_balance - new_principal, 0),
                     status = case when current_balance - new_principal <= 0 then 'closed'::debt_status else status end
      where id = new.debt_id;
  end if;

  return coalesce(new, old);
end $$;
create trigger transactions_sync_debt
  after insert or update or delete on transactions
  for each row execute function sync_debt_payment();

-- ───────────────────────── budgets & goals ─────────────────────────
create table budgets (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households (id) on delete cascade,
  month         date not null check (month = date_trunc('month', month)::date),
  currency      currency_code not null,
  daily_limit   numeric(20,2) check (daily_limit is null or daily_limit >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, month, currency)
);
create trigger budgets_updated before update on budgets
  for each row execute function set_updated_at();

create table budget_limits (
  id            uuid primary key default gen_random_uuid(),
  budget_id     uuid not null references budgets (id) on delete cascade,
  category_id   uuid not null references categories (id) on delete cascade,
  limit_amount  numeric(20,2) not null check (limit_amount >= 0),
  unique (budget_id, category_id)
);

create table financial_goals (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references households (id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  currency        currency_code not null,
  target_amount   numeric(20,2) not null check (target_amount > 0),
  current_amount  numeric(20,2) not null default 0 check (current_amount >= 0),
  target_date     date,
  account_id      uuid,
  status          goal_status not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (account_id, household_id) references accounts (id, household_id) on delete set null (account_id)
);
create index financial_goals_household_idx on financial_goals (household_id, status);
create trigger financial_goals_updated before update on financial_goals
  for each row execute function set_updated_at();

-- ───────────────────────── reports & notifications ─────────────────────────
create table scheduled_reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  household_id  uuid not null references households (id) on delete cascade,
  kind          report_kind not null,
  send_hour     smallint not null default 9 check (send_hour between 0 and 23),
  send_weekday  smallint check (send_weekday between 1 and 7),   -- weekly: ISO weekday
  enabled       boolean not null default true,
  last_sent_at  timestamptz,
  unique (user_id, household_id, kind)
);

create table notification_preferences (
  user_id               uuid primary key references profiles (id) on delete cascade,
  payment_reminders     boolean not null default true,
  reminder_days_before  smallint not null default 3 check (reminder_days_before between 0 and 30),
  budget_alerts         boolean not null default true,
  budget_alert_pct      smallint not null default 80 check (budget_alert_pct between 1 and 200),
  unusual_spend_alerts  boolean not null default true,
  updated_at            timestamptz not null default now()
);
create trigger notification_preferences_updated before update on notification_preferences
  for each row execute function set_updated_at();

-- ───────────────────────── AI audit & webhook idempotency ─────────────────────────
create table ai_interactions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references profiles (id) on delete set null,
  household_id       uuid references households (id) on delete set null,
  channel            data_source not null,
  kind               text not null,                 -- extract_transaction | summary | question | ...
  input_text         text,
  structured_output  jsonb,
  status             text not null default 'ok',    -- ok | invalid_output | error | needs_clarification
  error              text,                          -- never contains secrets
  model              text,
  tokens_in          integer,
  tokens_out         integer,
  transaction_id     uuid references transactions (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index ai_interactions_user_idx on ai_interactions (user_id, created_at desc);

-- Telegram sends each update_id once, but retries on timeouts: store it to process exactly once.
create table telegram_updates (
  update_id     bigint primary key,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  status        text not null default 'received'
);

-- Pending conversational state, e.g. a clarification question awaiting the user's answer.
create table pending_actions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles (id) on delete cascade,
  household_id   uuid not null references households (id) on delete cascade,
  transaction_id uuid references transactions (id) on delete cascade,
  kind           text not null,            -- confirm_transaction | clarify_currency | confirm_delete | ...
  payload        jsonb not null default '{}'::jsonb,
  expires_at     timestamptz not null default now() + interval '1 day',
  created_at     timestamptz not null default now()
);
create index pending_actions_user_idx on pending_actions (user_id, expires_at);
