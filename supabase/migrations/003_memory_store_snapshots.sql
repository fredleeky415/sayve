-- Transitional production repository for the current Memory Engine.
-- Keeps the whole MemoryStoreState in Supabase while normalized memory tables mature.

create table if not exists memory_store_snapshots (
  household_id uuid primary key references households(id) on delete cascade,
  state jsonb not null default '{}',
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table memory_store_snapshots enable row level security;

-- Snapshot repository rows are user-facing only through active household membership.
-- Founder Console aggregation uses the server service role.
create policy member_all_memory_store_snapshots on memory_store_snapshots
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create index if not exists memory_store_snapshots_updated_idx on memory_store_snapshots(updated_at desc);
create index if not exists memory_store_snapshots_revision_idx on memory_store_snapshots(household_id, revision);
