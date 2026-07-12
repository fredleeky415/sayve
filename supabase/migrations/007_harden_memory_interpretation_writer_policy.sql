-- Sayve V1 interpretation policy hardening.
-- Owners/members should be able to write the full normalized Memory projection.
-- memory_interpretations does not carry household_id directly, so writer access is
-- derived through the parent memory_object.

drop policy if exists writer_insert_memory_interpretations on memory_interpretations;

create policy writer_insert_memory_interpretations on memory_interpretations
  for insert
  with check (
    exists (
      select 1
      from memory_objects
      where memory_objects.id = memory_interpretations.memory_object_id
        and is_household_writer(memory_objects.household_id)
    )
  );

create or replace function sayve_household_role_policy_status()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'broadPolicyCount',
      count(*) filter (
        where policyname in (
          'member_all_household_categories',
          'member_all_captures',
          'member_all_memory_objects',
          'member_insert_memory_facts',
          'member_all_household_context',
          'member_all_memory_relationships',
          'member_all_revisions',
          'member_all_insights',
          'member_all_conversation',
          'member_all_ai_jobs',
          'member_all_usage_buckets'
        )
      ),
    'writerPolicyCount',
      count(*) filter (
        where policyname in (
          'writer_all_household_categories',
          'writer_all_captures',
          'writer_all_memory_objects',
          'writer_insert_memory_interpretations',
          'writer_insert_memory_facts',
          'writer_all_household_context',
          'writer_all_memory_relationships',
          'writer_all_revisions',
          'writer_all_insights',
          'writer_all_conversation',
          'writer_all_ai_jobs',
          'writer_all_usage_buckets'
        )
      ),
    'interpretationWriterPolicyCount',
      count(*) filter (
        where policyname = 'writer_insert_memory_interpretations'
      )
  )
  from pg_policies
  where schemaname = 'public';
$$;

revoke all on function sayve_household_role_policy_status() from public;
revoke all on function sayve_household_role_policy_status() from anon;
revoke all on function sayve_household_role_policy_status() from authenticated;
grant execute on function sayve_household_role_policy_status() to service_role;
