-- Sayve V1 security hardening.
-- The Memory Engine snapshot is the production source of truth during private beta.
-- Browser/mobile clients must interact through Sayve API routes, not direct Supabase writes.
-- The server service role owns snapshot reads/writes and bypasses RLS.

drop policy if exists member_all_memory_store_snapshots on memory_store_snapshots;

-- Intentionally no client policy for memory_store_snapshots.
-- This prevents authenticated household members from directly overwriting the JSONB MemoryStoreState.
-- User-facing access remains available through authenticated Sayve API routes.

create or replace function sayve_memory_store_snapshot_policy_count()
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer
  from pg_policies
  where schemaname = 'public'
    and tablename = 'memory_store_snapshots';
$$;

revoke all on function sayve_memory_store_snapshot_policy_count() from public;
revoke all on function sayve_memory_store_snapshot_policy_count() from anon;
revoke all on function sayve_memory_store_snapshot_policy_count() from authenticated;
grant execute on function sayve_memory_store_snapshot_policy_count() to service_role;
