-- Sayve V1 atomic invite acceptance.
-- Accepting an invite is an onboarding write with a single-use token. Keep it
-- inside Postgres so concurrent requests cannot add multiple users with the
-- same invite before accepted_at is set.

create or replace function sayve_accept_household_invite(invite_token text, accepting_user_id uuid)
returns table (
  ok boolean,
  error_code text,
  error_message text,
  household_id uuid,
  user_id uuid,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite_record invites%rowtype;
begin
  if invite_token is null or btrim(invite_token) = '' then
    return query select false, 'invite_not_found', 'Invite not found.', null::uuid, null::uuid, null::text;
    return;
  end if;

  select *
    into invite_record
    from invites
    where token = invite_token
    for update;

  if not found then
    return query select false, 'invite_not_found', 'Invite not found.', null::uuid, null::uuid, null::text;
    return;
  end if;

  if invite_record.accepted_at is not null then
    return query select false, 'invite_already_accepted', 'Invite was already accepted.', invite_record.household_id, accepting_user_id, invite_record.role;
    return;
  end if;

  if invite_record.expires_at < now() then
    return query select false, 'invite_expired', 'Invite expired.', invite_record.household_id, accepting_user_id, invite_record.role;
    return;
  end if;

  if invite_record.role not in ('member', 'viewer') then
    return query select false, 'invite_invalid_role', 'Invite role is invalid.', invite_record.household_id, accepting_user_id, invite_record.role;
    return;
  end if;

  insert into household_members (household_id, user_id, role)
  values (invite_record.household_id, accepting_user_id, invite_record.role)
  on conflict (household_id, user_id) do update
    set role = excluded.role;

  update invites
    set accepted_at = now()
    where id = invite_record.id;

  return query select true, null::text, null::text, invite_record.household_id, accepting_user_id, invite_record.role;
exception
  when foreign_key_violation then
    return query select false, 'invite_member_upsert_failed', SQLERRM, invite_record.household_id, accepting_user_id, invite_record.role;
  when others then
    return query select false, 'invite_member_upsert_failed', SQLERRM, invite_record.household_id, accepting_user_id, invite_record.role;
end;
$$;

revoke all on function sayve_accept_household_invite(text, uuid) from public;
revoke all on function sayve_accept_household_invite(text, uuid) from anon;
revoke all on function sayve_accept_household_invite(text, uuid) from authenticated;
grant execute on function sayve_accept_household_invite(text, uuid) to service_role;

create or replace function sayve_invite_accept_rpc_status()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'acceptFunctionCount',
    (
      select count(*)::integer
      from pg_proc
      where proname = 'sayve_accept_household_invite'
    )
  );
$$;

revoke all on function sayve_invite_accept_rpc_status() from public;
revoke all on function sayve_invite_accept_rpc_status() from anon;
revoke all on function sayve_invite_accept_rpc_status() from authenticated;
grant execute on function sayve_invite_accept_rpc_status() to service_role;
