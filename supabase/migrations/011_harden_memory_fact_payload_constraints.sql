-- Harden normalized financial fact payloads so storage cannot drift from
-- Sayve's Memory Engine contracts during direct staging/import.

alter table memory_facts
  drop constraint if exists memory_facts_payload_direction_check,
  drop constraint if exists memory_facts_payload_ownership_scope_check,
  drop constraint if exists memory_facts_payload_money_shape_check;

alter table memory_facts
  add constraint memory_facts_payload_direction_check
    check (
      not (payload ? 'direction')
      or payload->>'direction' in ('expense', 'income', 'transfer', 'unknown')
    ),
  add constraint memory_facts_payload_ownership_scope_check
    check (
      not (payload ? 'ownershipScope')
      or payload->>'ownershipScope' in ('shared', 'member')
    ),
  add constraint memory_facts_payload_money_shape_check
    check (
      not (payload ? 'money')
      or (
        jsonb_typeof(payload->'money') = 'object'
        and ((payload->'money') ? 'amount')
        and jsonb_typeof(payload #> '{money,amount}') = 'number'
      )
    );

create or replace function sayve_memory_fact_payload_constraint_status()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'directionConstraintCount', count(*) filter (where c.conname = 'memory_facts_payload_direction_check'),
    'ownershipConstraintCount', count(*) filter (where c.conname = 'memory_facts_payload_ownership_scope_check'),
    'moneyShapeConstraintCount', count(*) filter (where c.conname = 'memory_facts_payload_money_shape_check')
  )
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'memory_facts';
$$;

revoke all on function sayve_memory_fact_payload_constraint_status() from public;
grant execute on function sayve_memory_fact_payload_constraint_status() to service_role;
