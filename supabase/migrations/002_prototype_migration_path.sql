-- Sayve V1 prototype migration path
-- Keeps local demo ids as external ids so prototype memories can be imported without losing traceability.

alter table households add column if not exists external_id text;
alter table household_categories add column if not exists external_id text;
alter table captures add column if not exists external_id text;
alter table memory_objects add column if not exists external_id text;
alter table memory_interpretations add column if not exists external_id text;
alter table memory_facts add column if not exists external_id text;
alter table household_context add column if not exists external_id text;
alter table memory_relationships add column if not exists external_id text;
alter table memory_revisions add column if not exists external_id text;
alter table insights add column if not exists external_id text;
alter table conversation_messages add column if not exists external_id text;
alter table ai_telemetry_events add column if not exists external_id text;

create unique index if not exists households_external_id_idx on households(external_id) where external_id is not null;
create unique index if not exists household_categories_external_id_idx on household_categories(household_id, external_id) where external_id is not null;
create unique index if not exists captures_external_id_idx on captures(household_id, external_id) where external_id is not null;
create unique index if not exists memory_objects_external_id_idx on memory_objects(household_id, external_id) where external_id is not null;
create unique index if not exists memory_interpretations_external_id_idx on memory_interpretations(memory_object_id, external_id) where external_id is not null;
create unique index if not exists memory_facts_external_id_idx on memory_facts(household_id, external_id) where external_id is not null;
create unique index if not exists household_context_external_id_idx on household_context(household_id, external_id) where external_id is not null;
create unique index if not exists memory_relationships_external_id_idx on memory_relationships(household_id, external_id) where external_id is not null;
create unique index if not exists memory_revisions_external_id_idx on memory_revisions(household_id, external_id) where external_id is not null;
create unique index if not exists insights_external_id_idx on insights(household_id, external_id) where external_id is not null;
create unique index if not exists conversation_messages_external_id_idx on conversation_messages(household_id, external_id) where external_id is not null;
create unique index if not exists ai_telemetry_events_external_id_idx on ai_telemetry_events(household_id, external_id) where external_id is not null;

create table if not exists usage_buckets (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  household_id uuid not null references households(id) on delete cascade,
  month text not null,
  captures integer not null default 0,
  receipt_captures integer not null default 0,
  voice_captures integer not null default 0,
  conversation_turns integer not null default 0,
  dashboard_views integer not null default 0,
  ai_interpretations integer not null default 0,
  limit_events jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  unique (household_id, month)
);

alter table usage_buckets enable row level security;

create policy member_all_usage_buckets on usage_buckets
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create table if not exists memory_import_batches (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete set null,
  source text not null default 'prototype_store',
  status text not null default 'staged' check (status in ('staged', 'importing', 'succeeded', 'failed')),
  external_household_id text,
  payload jsonb not null,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table memory_import_batches enable row level security;

-- Import batches are a founder/admin tool. Service-role access should process them server-side.
-- No client policy is intentionally created for memory_import_batches.
