-- 0002_rls.sql
-- Row Level Security. Browser clients use the `authenticated` role and see only
-- households they belong to. Privileged work (Telegram bot, n8n, rate imports,
-- AI audit writes) goes through the service_role key on the trusted server,
-- which bypasses RLS.

-- ───────────────────────── membership helpers ─────────────────────────
-- SECURITY DEFINER so that policies on household_members can call them without recursion.
create or replace function is_household_member(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

create or replace function household_role_of(hid uuid) returns household_role
language sql stable security definer set search_path = public as $$
  select role from household_members
  where household_id = hid and user_id = auth.uid();
$$;

-- viewer: read only; member: read/write data; admin/owner: also manage members & settings.
create or replace function can_write_household(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(household_role_of(hid) in ('owner', 'admin', 'member'), false);
$$;

create or replace function can_admin_household(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(household_role_of(hid) in ('owner', 'admin'), false);
$$;

revoke all on function is_household_member(uuid), household_role_of(uuid),
  can_write_household(uuid), can_admin_household(uuid) from public;
grant execute on function is_household_member(uuid), household_role_of(uuid),
  can_write_household(uuid), can_admin_household(uuid) to authenticated, service_role;

-- ───────────────────────── enable RLS everywhere ─────────────────────────
alter table profiles                 enable row level security;
alter table telegram_link_codes      enable row level security;
alter table households               enable row level security;
alter table household_members        enable row level security;
alter table accounts                 enable row level security;
alter table categories               enable row level security;
alter table exchange_rates           enable row level security;
alter table debts                    enable row level security;
alter table debt_payments            enable row level security;
alter table transactions             enable row level security;
alter table budgets                  enable row level security;
alter table budget_limits            enable row level security;
alter table financial_goals          enable row level security;
alter table scheduled_reports        enable row level security;
alter table notification_preferences enable row level security;
alter table ai_interactions          enable row level security;
alter table telegram_updates         enable row level security;
alter table pending_actions          enable row level security;

-- ───────────────────────── profiles ─────────────────────────
-- Members of a shared household can see each other's display name.
create policy profiles_select on profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from household_members a
      join household_members b on a.household_id = b.household_id
      where a.user_id = auth.uid() and b.user_id = profiles.id
    )
  );
create policy profiles_insert on profiles for insert to authenticated
  with check (id = auth.uid());
-- telegram_user_id / telegram_chat_id are set only by the server after verified linking.
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- Column-level REVOKE is a no-op when the role holds table-wide UPDATE (Supabase default),
-- so enforce with a trigger. Not SECURITY DEFINER: current_user is the calling API role.
create or replace function protect_profile_telegram_fields() returns trigger
language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.telegram_user_id is distinct from old.telegram_user_id
          or new.telegram_chat_id is distinct from old.telegram_chat_id) then
    raise exception 'telegram link can only be changed by the server' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_protect_telegram before update on profiles
  for each row execute function protect_profile_telegram_fields();

-- link codes: server only (no policies for authenticated = no access)

-- ───────────────────────── households & members ─────────────────────────
create policy households_select on households for select to authenticated
  using (is_household_member(id));
create policy households_insert on households for insert to authenticated
  with check (created_by = auth.uid());
create policy households_update on households for update to authenticated
  using (can_admin_household(id)) with check (can_admin_household(id));
create policy households_delete on households for delete to authenticated
  using (household_role_of(id) = 'owner');

create policy members_select on household_members for select to authenticated
  using (is_household_member(household_id));
-- Adding members and changing roles: admins only; the owner row can only be handled by the owner.
create policy members_insert on household_members for insert to authenticated
  with check (can_admin_household(household_id) and role <> 'owner');
create policy members_update on household_members for update to authenticated
  using (can_admin_household(household_id) and role <> 'owner')
  with check (can_admin_household(household_id) and role <> 'owner');
create policy members_delete on household_members for delete to authenticated
  using (
    (can_admin_household(household_id) and role <> 'owner')
    or user_id = auth.uid() and role <> 'owner'   -- members may leave; owners must transfer first
  );

-- ───────────────────────── household-scoped data ─────────────────────────
-- accounts
create policy accounts_select on accounts for select to authenticated
  using (is_household_member(household_id));
create policy accounts_insert on accounts for insert to authenticated
  with check (can_write_household(household_id));
create policy accounts_update on accounts for update to authenticated
  using (can_write_household(household_id)) with check (can_write_household(household_id));
create policy accounts_delete on accounts for delete to authenticated
  using (can_admin_household(household_id));

-- categories: system rows readable by everyone, custom rows by household
create policy categories_select on categories for select to authenticated
  using (household_id is null or is_household_member(household_id));
create policy categories_insert on categories for insert to authenticated
  with check (household_id is not null and is_system = false and can_write_household(household_id));
create policy categories_update on categories for update to authenticated
  using (household_id is not null and is_system = false and can_write_household(household_id))
  with check (household_id is not null and is_system = false and can_write_household(household_id));
create policy categories_delete on categories for delete to authenticated
  using (household_id is not null and is_system = false and can_write_household(household_id));

-- exchange rates: read-only for clients, written by server job
create policy exchange_rates_select on exchange_rates for select to authenticated
  using (true);

-- debts
create policy debts_select on debts for select to authenticated
  using (is_household_member(household_id));
create policy debts_insert on debts for insert to authenticated
  with check (can_write_household(household_id));
create policy debts_update on debts for update to authenticated
  using (can_write_household(household_id)) with check (can_write_household(household_id));
create policy debts_delete on debts for delete to authenticated
  using (can_admin_household(household_id));

-- debt_payments are derived from transactions by a trigger; read-only for clients
create policy debt_payments_select on debt_payments for select to authenticated
  using (is_household_member(household_id));

-- transactions
create policy transactions_select on transactions for select to authenticated
  using (is_household_member(household_id));
create policy transactions_insert on transactions for insert to authenticated
  with check (can_write_household(household_id) and created_by = auth.uid());
create policy transactions_update on transactions for update to authenticated
  using (can_write_household(household_id))
  with check (can_write_household(household_id));
create policy transactions_delete on transactions for delete to authenticated
  using (can_write_household(household_id));

-- budgets
create policy budgets_select on budgets for select to authenticated
  using (is_household_member(household_id));
create policy budgets_write on budgets for all to authenticated
  using (can_write_household(household_id)) with check (can_write_household(household_id));

create policy budget_limits_select on budget_limits for select to authenticated
  using (exists (select 1 from budgets b where b.id = budget_id and is_household_member(b.household_id)));
create policy budget_limits_write on budget_limits for all to authenticated
  using (exists (select 1 from budgets b where b.id = budget_id and can_write_household(b.household_id)))
  with check (exists (select 1 from budgets b where b.id = budget_id and can_write_household(b.household_id)));

-- goals
create policy goals_select on financial_goals for select to authenticated
  using (is_household_member(household_id));
create policy goals_write on financial_goals for all to authenticated
  using (can_write_household(household_id)) with check (can_write_household(household_id));

-- ───────────────────────── per-user data ─────────────────────────
create policy scheduled_reports_own on scheduled_reports for all to authenticated
  using (user_id = auth.uid() and is_household_member(household_id))
  with check (user_id = auth.uid() and is_household_member(household_id));

create policy notification_preferences_own on notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- AI audit log: users may read their own interactions; writes only from the server.
create policy ai_interactions_select on ai_interactions for select to authenticated
  using (user_id = auth.uid());

-- pending_actions & telegram_updates: server only (no policies for authenticated).
