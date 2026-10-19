-- 0006_default_accounts.sql
-- Per-user default account for each currency, used when a Telegram message names no account
-- ("Потратила 500 рублей" → the user's default RUB account). Without a default the bot asks.

create table default_accounts (
  user_id       uuid not null references profiles (id) on delete cascade,
  household_id  uuid not null references households (id) on delete cascade,
  currency      currency_code not null,
  account_id    uuid not null,
  primary key (user_id, household_id, currency),
  foreign key (account_id, household_id) references accounts (id, household_id) on delete cascade
);

-- The account's currency must match the slot.
create or replace function check_default_account_currency() returns trigger
language plpgsql as $$
begin
  if (select currency from accounts where id = new.account_id) <> new.currency then
    raise exception 'default account currency mismatch';
  end if;
  return new;
end $$;
create trigger default_accounts_currency before insert or update on default_accounts
  for each row execute function check_default_account_currency();

alter table default_accounts enable row level security;
create policy default_accounts_own on default_accounts for all to authenticated
  using (user_id = auth.uid() and is_household_member(household_id))
  with check (user_id = auth.uid() and is_household_member(household_id));
