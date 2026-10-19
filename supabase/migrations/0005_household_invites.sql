-- 0005_household_invites.sql
-- Invite links for family members. Only the SHA-256 hash of the token is stored;
-- the plain token is shown once to the inviter and travels in the link.

create table household_invites (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households (id) on delete cascade,
  token_hash    text not null unique,
  role          household_role not null default 'member' check (role in ('admin', 'member', 'viewer')),
  created_by    uuid not null references profiles (id) on delete cascade,
  expires_at    timestamptz not null default now() + interval '7 days',
  used_by       uuid references profiles (id) on delete set null,
  used_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index household_invites_household_idx on household_invites (household_id);

alter table household_invites enable row level security;

create policy invites_select on household_invites for select to authenticated
  using (can_admin_household(household_id));
create policy invites_insert on household_invites for insert to authenticated
  with check (can_admin_household(household_id) and created_by = auth.uid());
create policy invites_delete on household_invites for delete to authenticated
  using (can_admin_household(household_id));

-- Redeem an invite. SECURITY DEFINER because the invitee is not yet a member and so cannot
-- read the invite row through RLS. Single use, expires, role limited by the table check.
create or replace function accept_household_invite(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  inv household_invites;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into inv from household_invites
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and used_at is null and expires_at > now()
   for update;
  if not found then
    raise exception 'invalid_or_expired_invite' using errcode = 'P0001';
  end if;

  insert into household_members (household_id, user_id, role)
  values (inv.household_id, auth.uid(), inv.role)
  on conflict (household_id, user_id) do nothing;

  update household_invites set used_by = auth.uid(), used_at = now() where id = inv.id;
  return inv.household_id;
end $$;

revoke all on function accept_household_invite(text) from public;
grant execute on function accept_household_invite(text) to authenticated;
