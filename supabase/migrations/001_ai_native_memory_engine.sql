-- Sayve V1
-- Database is a projection of the Memory Engine, not the product starting point.

create extension if not exists pgcrypto;
create extension if not exists vector;

create type memory_domain as enum ('financial', 'warranty', 'insurance', 'home', 'car', 'medical', 'document');
create type capture_source as enum ('text', 'receipt', 'voice', 'email', 'bank_import');
create type memory_status as enum ('auto_confirmed', 'review_later', 'needs_user_input', 'archived');
create type memory_state as enum ('active', 'merged', 'needs_review', 'needs_user_input', 'archived');
create type relationship_type as enum (
  'supports_same_memory',
  'contradicts_context',
  'updates_context',
  'derived_from',
  'answers_with',
  'replaces_interpretation',
  'similar_to'
);

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  default_currency text not null default 'HKD',
  locale text not null default 'zh-Hant-HK',
  created_at timestamptz not null default now()
);

create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table household_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  color text,
  created_by text not null default 'user' check (created_by in ('user', 'system')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create table invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  email text,
  role text not null default 'member' check (role in ('member', 'viewer')),
  token text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table captures (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  source_type capture_source not null,
  raw_text text,
  transcript text,
  file_refs text[] not null default '{}',
  metadata jsonb not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table memory_objects (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  domain memory_domain not null default 'financial',
  title text not null,
  current_state memory_state not null default 'active',
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  status memory_status not null,
  source_refs jsonb not null default '[]',
  embedding vector(1536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table memory_interpretations (
  id uuid primary key default gen_random_uuid(),
  memory_object_id uuid not null references memory_objects(id) on delete cascade,
  model text not null,
  prompt_version text not null,
  intent text not null,
  structured_output jsonb not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  confidence_band text not null check (confidence_band in ('high', 'medium', 'low')),
  reasoning_summary text not null,
  source_refs jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table memory_facts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  memory_object_id uuid not null references memory_objects(id) on delete cascade,
  domain memory_domain not null default 'financial',
  payload jsonb not null,
  source_refs jsonb not null default '[]',
  immutable boolean not null default true,
  created_at timestamptz not null default now()
);

create table household_context (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  domain memory_domain not null default 'financial',
  subject text not null,
  state text not null,
  current_state text not null default 'active' check (current_state in ('active', 'superseded', 'uncertain')),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  source_refs jsonb not null default '[]',
  effective_from date,
  updated_at timestamptz not null default now()
);

create table memory_relationships (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  from_type text not null,
  from_id uuid not null,
  to_type text not null,
  to_id uuid not null,
  relationship_type relationship_type not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  reason text not null,
  created_at timestamptz not null default now()
);

create table memory_revisions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  memory_object_id uuid not null references memory_objects(id) on delete cascade,
  revision_type text not null,
  actor text not null check (actor in ('ai', 'user', 'system')),
  reason text not null,
  diff jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table insights (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  severity text not null check (severity in ('info', 'review', 'attention')),
  title text not null,
  explanation text not null,
  source_refs jsonb not null default '[]',
  dismissed boolean not null default false,
  created_at timestamptz not null default now()
);

create table conversation_messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_by uuid references auth.users(id),
  confidence numeric check (confidence >= 0 and confidence <= 1),
  source_refs jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table ai_jobs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  job_type text not null check (job_type in ('extract', 'merge', 'reprocess', 'evolution', 'insight_generation')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  input jsonb not null default '{}',
  output jsonb,
  model text,
  prompt_version text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table ai_telemetry_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  phase text not null,
  model text not null,
  provider text not null check (provider in ('openai', 'heuristic', 'system')),
  source_type capture_source,
  memory_object_id uuid references memory_objects(id) on delete set null,
  capture_id uuid references captures(id) on delete set null,
  conversation_message_id uuid references conversation_messages(id) on delete set null,
  status text not null check (status in ('success', 'fallback', 'limited', 'error')),
  confidence numeric check (confidence >= 0 and confidence <= 1),
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  estimated_cost_usd numeric,
  duration_ms integer,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index captures_household_created_idx on captures(household_id, created_at desc);
create index household_members_user_idx on household_members(user_id, created_at desc);
create index household_categories_active_idx on household_categories(household_id, archived_at);
create index invites_household_status_idx on invites(household_id, accepted_at, expires_at);
create index memory_objects_household_updated_idx on memory_objects(household_id, updated_at desc);
create index memory_facts_household_created_idx on memory_facts(household_id, created_at desc);
create index household_context_active_idx on household_context(household_id, current_state);
create index insights_inbox_idx on insights(household_id, dismissed, created_at desc);
create index ai_telemetry_household_created_idx on ai_telemetry_events(household_id, created_at desc);
create index ai_telemetry_phase_model_idx on ai_telemetry_events(phase, model, created_at desc);

alter table households enable row level security;
alter table household_members enable row level security;
alter table household_categories enable row level security;
alter table invites enable row level security;
alter table captures enable row level security;
alter table memory_objects enable row level security;
alter table memory_interpretations enable row level security;
alter table memory_facts enable row level security;
alter table household_context enable row level security;
alter table memory_relationships enable row level security;
alter table memory_revisions enable row level security;
alter table insights enable row level security;
alter table conversation_messages enable row level security;
alter table ai_jobs enable row level security;
alter table ai_telemetry_events enable row level security;

-- Service-role only by design:
-- invites are created/accepted through onboarding endpoints, not direct client access.
-- ai_telemetry_events and memory_import_batches are founder/internal telemetry/import paths.

create or replace function is_household_member(target_household uuid)
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
  );
$$;

create policy household_member_select on households
  for select using (is_household_member(id));

create policy household_member_rows on household_members
  for select using (is_household_member(household_id));

create policy member_all_household_categories on household_categories
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy member_all_captures on captures
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy member_all_memory_objects on memory_objects
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy member_select_memory_facts on memory_facts
  for select using (is_household_member(household_id));

create policy member_insert_memory_facts on memory_facts
  for insert
  with check (is_household_member(household_id));

create policy member_all_household_context on household_context
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy member_all_memory_relationships on memory_relationships
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy member_all_revisions on memory_revisions
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy member_all_insights on insights
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy member_all_conversation on conversation_messages
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy member_all_ai_jobs on ai_jobs
  for all using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy member_read_interpretations on memory_interpretations
  for select using (
    exists (
      select 1 from memory_objects
      where memory_objects.id = memory_interpretations.memory_object_id
        and is_household_member(memory_objects.household_id)
    )
  );

-- Facts are sacred for normal product paths. Updates/deletes are intentionally absent for clients.
