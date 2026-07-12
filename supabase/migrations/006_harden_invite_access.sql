-- Sayve V1 invite access hardening.
-- Invite tokens are onboarding credentials, so browser/mobile clients should not
-- read or write invite rows directly. Sayve API routes own invite creation and
-- acceptance through the server service role.

drop policy if exists member_all_invites on invites;
drop policy if exists member_read_invites on invites;
drop policy if exists writer_all_invites on invites;
drop policy if exists invite_select on invites;
drop policy if exists invite_insert on invites;
drop policy if exists invite_update on invites;

-- Intentionally no client policy for invites.
-- Server service role bypasses RLS and owns invite reads/writes.

create or replace function sayve_invite_policy_count()
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer
  from pg_policies
  where schemaname = 'public'
    and tablename = 'invites';
$$;

revoke all on function sayve_invite_policy_count() from public;
revoke all on function sayve_invite_policy_count() from anon;
revoke all on function sayve_invite_policy_count() from authenticated;
grant execute on function sayve_invite_policy_count() to service_role;
