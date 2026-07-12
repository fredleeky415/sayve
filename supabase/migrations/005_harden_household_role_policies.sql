-- Sayve V1 role-aware RLS hardening.
-- Household viewers can read shared Family Memory but cannot write directly to Supabase tables.
-- Sayve API routes still own runtime writes through the server service role.

create or replace function is_household_writer(target_household uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from household_members
    where household_id = target_household
      and user_id = auth.uid()
      and role in ('owner', 'member')
  );
$$;

drop policy if exists member_all_household_categories on household_categories;
drop policy if exists member_all_captures on captures;
drop policy if exists member_all_memory_objects on memory_objects;
drop policy if exists member_insert_memory_facts on memory_facts;
drop policy if exists member_all_household_context on household_context;
drop policy if exists member_all_memory_relationships on memory_relationships;
drop policy if exists member_all_revisions on memory_revisions;
drop policy if exists member_all_insights on insights;
drop policy if exists member_all_conversation on conversation_messages;
drop policy if exists member_all_ai_jobs on ai_jobs;
drop policy if exists member_all_usage_buckets on usage_buckets;

create policy member_read_household_categories on household_categories
  for select using (is_household_member(household_id));

create policy writer_all_household_categories on household_categories
  for all using (is_household_writer(household_id))
  with check (is_household_writer(household_id));

create policy member_read_captures on captures
  for select using (is_household_member(household_id));

create policy writer_all_captures on captures
  for all using (is_household_writer(household_id))
  with check (is_household_writer(household_id));

create policy member_read_memory_objects on memory_objects
  for select using (is_household_member(household_id));

create policy writer_all_memory_objects on memory_objects
  for all using (is_household_writer(household_id))
  with check (is_household_writer(household_id));

create policy writer_insert_memory_facts on memory_facts
  for insert
  with check (is_household_writer(household_id));

create policy member_read_household_context on household_context
  for select using (is_household_member(household_id));

create policy writer_all_household_context on household_context
  for all using (is_household_writer(household_id))
  with check (is_household_writer(household_id));

create policy member_read_memory_relationships on memory_relationships
  for select using (is_household_member(household_id));

create policy writer_all_memory_relationships on memory_relationships
  for all using (is_household_writer(household_id))
  with check (is_household_writer(household_id));

create policy member_read_revisions on memory_revisions
  for select using (is_household_member(household_id));

create policy writer_all_revisions on memory_revisions
  for all using (is_household_writer(household_id))
  with check (is_household_writer(household_id));

create policy member_read_insights on insights
  for select using (is_household_member(household_id));

create policy writer_all_insights on insights
  for all using (is_household_writer(household_id))
  with check (is_household_writer(household_id));

create policy member_read_conversation on conversation_messages
  for select using (is_household_member(household_id));

create policy writer_all_conversation on conversation_messages
  for all using (is_household_writer(household_id))
  with check (is_household_writer(household_id));

create policy member_read_ai_jobs on ai_jobs
  for select using (is_household_member(household_id));

create policy writer_all_ai_jobs on ai_jobs
  for all using (is_household_writer(household_id))
  with check (is_household_writer(household_id));

create policy member_read_usage_buckets on usage_buckets
  for select using (is_household_member(household_id));

create policy writer_all_usage_buckets on usage_buckets
  for all using (is_household_writer(household_id))
  with check (is_household_writer(household_id));

revoke all on function is_household_writer(uuid) from public;
grant execute on function is_household_writer(uuid) to authenticated;

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
          'writer_insert_memory_facts',
          'writer_all_household_context',
          'writer_all_memory_relationships',
          'writer_all_revisions',
          'writer_all_insights',
          'writer_all_conversation',
          'writer_all_ai_jobs',
          'writer_all_usage_buckets'
        )
      )
  )
  from pg_policies
  where schemaname = 'public';
$$;

revoke all on function sayve_household_role_policy_status() from public;
revoke all on function sayve_household_role_policy_status() from anon;
revoke all on function sayve_household_role_policy_status() from authenticated;
grant execute on function sayve_household_role_policy_status() to service_role;
