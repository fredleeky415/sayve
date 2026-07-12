#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationDir = join(process.cwd(), "supabase", "migrations");

const migrations = {
  "001_ai_native_memory_engine.sql": readFileSync(join(migrationDir, "001_ai_native_memory_engine.sql"), "utf8"),
  "002_prototype_migration_path.sql": readFileSync(join(migrationDir, "002_prototype_migration_path.sql"), "utf8"),
  "003_memory_store_snapshots.sql": readFileSync(join(migrationDir, "003_memory_store_snapshots.sql"), "utf8"),
  "004_harden_memory_store_access.sql": readFileSync(join(migrationDir, "004_harden_memory_store_access.sql"), "utf8"),
  "005_harden_household_role_policies.sql": readFileSync(join(migrationDir, "005_harden_household_role_policies.sql"), "utf8"),
  "006_harden_invite_access.sql": readFileSync(join(migrationDir, "006_harden_invite_access.sql"), "utf8"),
  "007_harden_memory_interpretation_writer_policy.sql": readFileSync(join(migrationDir, "007_harden_memory_interpretation_writer_policy.sql"), "utf8"),
  "008_atomic_invite_acceptance.sql": readFileSync(join(migrationDir, "008_atomic_invite_acceptance.sql"), "utf8"),
  "009_revision_actor_attribution.sql": readFileSync(join(migrationDir, "009_revision_actor_attribution.sql"), "utf8"),
  "010_category_actor_attribution.sql": readFileSync(join(migrationDir, "010_category_actor_attribution.sql"), "utf8"),
  "011_harden_memory_fact_payload_constraints.sql": readFileSync(join(migrationDir, "011_harden_memory_fact_payload_constraints.sql"), "utf8"),
  "012_harden_ai_telemetry_constraints.sql": readFileSync(join(migrationDir, "012_harden_ai_telemetry_constraints.sql"), "utf8")
};

const requiredTables = [
  "households",
  "household_members",
  "household_categories",
  "captures",
  "memory_objects",
  "memory_interpretations",
  "memory_facts",
  "household_context",
  "memory_relationships",
  "memory_revisions",
  "insights",
  "conversation_messages",
  "ai_jobs",
  "ai_telemetry_events"
];

const externalIdTables = [
  "households",
  "household_categories",
  "captures",
  "memory_objects",
  "memory_interpretations",
  "memory_facts",
  "household_context",
  "memory_relationships",
  "memory_revisions",
  "insights",
  "conversation_messages",
  "ai_telemetry_events"
];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function includesSql(sql, expected) {
  return sql.toLowerCase().includes(expected.toLowerCase());
}

function assertIncludes(sql, expected, label) {
  if (!includesSql(sql, expected)) fail(`${label} missing: ${expected}`);
}

const base = migrations["001_ai_native_memory_engine.sql"];
const migrationPath = migrations["002_prototype_migration_path.sql"];
const snapshots = migrations["003_memory_store_snapshots.sql"];
const hardening = migrations["004_harden_memory_store_access.sql"];
const roleHardening = migrations["005_harden_household_role_policies.sql"];
const inviteHardening = migrations["006_harden_invite_access.sql"];
const interpretationHardening = migrations["007_harden_memory_interpretation_writer_policy.sql"];
const atomicInviteAcceptance = migrations["008_atomic_invite_acceptance.sql"];
const revisionActorAttribution = migrations["009_revision_actor_attribution.sql"];
const categoryActorAttribution = migrations["010_category_actor_attribution.sql"];
const memoryFactPayloadConstraints = migrations["011_harden_memory_fact_payload_constraints.sql"];
const aiTelemetryConstraints = migrations["012_harden_ai_telemetry_constraints.sql"];

for (const table of requiredTables) {
  assertIncludes(base, `create table ${table}`, "001 base schema");
  assertIncludes(base, `alter table ${table} enable row level security`, "001 RLS");
}

for (const enumValue of ["financial", "warranty", "insurance", "home", "car", "medical", "document"]) {
  assertIncludes(base, enumValue, "001 memory_domain extensibility");
}

for (const relationshipType of ["supports_same_memory", "contradicts_context", "updates_context", "derived_from"]) {
  assertIncludes(base, relationshipType, "001 relationship_type");
}

assertIncludes(base, "immutable boolean not null default true", "001 sacred facts");
assertIncludes(base, "create extension if not exists vector", "001 vector extension");
assertIncludes(base, "create table ai_telemetry_events", "001 telemetry");
assertIncludes(base, "estimated_cost_usd", "001 telemetry cost tracking");
assertIncludes(base, "duration_ms", "001 telemetry latency tracking");
assertIncludes(base, "Facts are sacred for normal product paths", "001 fact immutability note");
assertIncludes(base, "create table invites", "001 invite onboarding");
assertIncludes(base, "token text not null unique", "001 invite token uniqueness");
assertIncludes(base, "role text not null default 'member' check (role in ('member', 'viewer'))", "001 invite role constraint");
assertIncludes(base, "created_by uuid references auth.users(id)", "001 member-authored captures and conversation");
assertIncludes(base, "alter table invites enable row level security", "001 invite RLS");
assertIncludes(base, "household_members_user_idx", "001 household member lookup index");
assertIncludes(base, "invites_household_status_idx", "001 invite household status index");
assertIncludes(base, "Service-role only by design", "001 internal service-role boundary note");

for (const table of externalIdTables) {
  assertIncludes(migrationPath, `alter table ${table} add column if not exists external_id text`, "002 external id column");
  assertIncludes(migrationPath, `${table}_external_id_idx`, "002 external id index");
}

for (const table of ["usage_buckets", "memory_import_batches"]) {
  assertIncludes(migrationPath, `create table if not exists ${table}`, "002 migration support table");
  assertIncludes(migrationPath, `alter table ${table} enable row level security`, "002 RLS");
}
assertIncludes(migrationPath, "No client policy is intentionally created for memory_import_batches", "002 import admin-only boundary");

assertIncludes(snapshots, "create table if not exists memory_store_snapshots", "003 snapshot table");
assertIncludes(snapshots, "state jsonb not null default '{}'", "003 snapshot state");
assertIncludes(snapshots, "revision integer not null default 0", "003 snapshot optimistic revision");
assertIncludes(snapshots, "alter table memory_store_snapshots enable row level security", "003 snapshot RLS");
assertIncludes(snapshots, "member_all_memory_store_snapshots", "003 snapshot policy");
assertIncludes(snapshots, "memory_store_snapshots_updated_idx", "003 snapshot index");
assertIncludes(snapshots, "memory_store_snapshots_revision_idx", "003 snapshot revision index");
assertIncludes(snapshots, "Founder Console aggregation uses the server service role", "003 founder aggregation boundary");

assertIncludes(hardening, "drop policy if exists member_all_memory_store_snapshots", "004 snapshot direct client write hardening");
assertIncludes(hardening, "Intentionally no client policy for memory_store_snapshots", "004 service-role-only snapshot boundary");
assertIncludes(hardening, "server service role owns snapshot reads/writes", "004 server-owned memory boundary");
assertIncludes(hardening, "create or replace function sayve_memory_store_snapshot_policy_count", "004 live policy hardening check rpc");
assertIncludes(hardening, "from pg_policies", "004 live policy hardening checks pg_policies");
assertIncludes(hardening, "grant execute on function sayve_memory_store_snapshot_policy_count() to service_role", "004 policy check is service-role callable");

assertIncludes(roleHardening, "create or replace function is_household_writer", "005 household writer role function");
assertIncludes(roleHardening, "role in ('owner', 'member')", "005 owner/member write role boundary");
assertIncludes(roleHardening, "drop policy if exists member_all_captures", "005 drops broad capture write policy");
assertIncludes(roleHardening, "drop policy if exists member_all_usage_buckets", "005 drops broad usage write policy");
assertIncludes(roleHardening, "create policy member_read_captures", "005 viewer-readable captures policy");
assertIncludes(roleHardening, "create policy writer_all_captures", "005 writer-only captures policy");
assertIncludes(roleHardening, "create policy member_read_conversation", "005 viewer-readable conversation policy");
assertIncludes(roleHardening, "create policy writer_all_conversation", "005 writer-only conversation policy");
assertIncludes(roleHardening, "create policy writer_insert_memory_facts", "005 writer-only fact insert policy");
assertIncludes(roleHardening, "create or replace function sayve_household_role_policy_status", "005 live role policy status rpc");
assertIncludes(roleHardening, "broadPolicyCount", "005 reports broad policy count");
assertIncludes(roleHardening, "writerPolicyCount", "005 reports writer policy count");
assertIncludes(roleHardening, "grant execute on function sayve_household_role_policy_status() to service_role", "005 role policy check is service-role callable");

assertIncludes(inviteHardening, "drop policy if exists member_all_invites", "006 drops broad invite policy");
assertIncludes(inviteHardening, "Intentionally no client policy for invites", "006 service-role-only invite boundary");
assertIncludes(inviteHardening, "Server service role bypasses RLS and owns invite reads/writes", "006 server-owned invite boundary");
assertIncludes(inviteHardening, "create or replace function sayve_invite_policy_count", "006 live invite policy check rpc");
assertIncludes(inviteHardening, "from pg_policies", "006 live invite policy checks pg_policies");
assertIncludes(inviteHardening, "grant execute on function sayve_invite_policy_count() to service_role", "006 invite policy check is service-role callable");

assertIncludes(interpretationHardening, "drop policy if exists writer_insert_memory_interpretations", "007 idempotent interpretation writer policy");
assertIncludes(interpretationHardening, "create policy writer_insert_memory_interpretations", "007 writer-only interpretation insert policy");
assertIncludes(interpretationHardening, "is_household_writer(memory_objects.household_id)", "007 interpretation writer role boundary");
assertIncludes(interpretationHardening, "create or replace function sayve_household_role_policy_status", "007 refreshes live role policy status rpc");
assertIncludes(interpretationHardening, "writer_insert_memory_interpretations", "007 reports interpretation writer policy");
assertIncludes(interpretationHardening, "interpretationWriterPolicyCount", "007 live role policy rpc reports interpretation writer policy count");
assertIncludes(interpretationHardening, "grant execute on function sayve_household_role_policy_status() to service_role", "007 role policy check remains service-role callable");

assertIncludes(atomicInviteAcceptance, "create or replace function sayve_accept_household_invite", "008 atomic invite acceptance rpc");
assertIncludes(atomicInviteAcceptance, "for update", "008 invite row lock");
assertIncludes(atomicInviteAcceptance, "insert into household_members", "008 accepts invite into household members");
assertIncludes(atomicInviteAcceptance, "on conflict (household_id, user_id) do update", "008 idempotent member upsert");
assertIncludes(atomicInviteAcceptance, "update invites", "008 marks invite accepted");
assertIncludes(atomicInviteAcceptance, "grant execute on function sayve_accept_household_invite(text, uuid) to service_role", "008 accept rpc is service-role callable");
assertIncludes(atomicInviteAcceptance, "create or replace function sayve_invite_accept_rpc_status", "008 live accept rpc status check");
assertIncludes(atomicInviteAcceptance, "acceptFunctionCount", "008 reports accept rpc availability");

assertIncludes(revisionActorAttribution, "alter table memory_revisions", "009 revision actor attribution table");
assertIncludes(revisionActorAttribution, "actor_user_id uuid references auth.users(id)", "009 revision actor user column");
assertIncludes(revisionActorAttribution, "memory_revisions_actor_user_idx", "009 revision actor lookup index");

assertIncludes(categoryActorAttribution, "alter table household_categories", "010 category actor attribution table");
assertIncludes(categoryActorAttribution, "created_by_user_id uuid references auth.users(id)", "010 category actor user column");
assertIncludes(categoryActorAttribution, "household_categories_created_by_user_idx", "010 category actor lookup index");

assertIncludes(memoryFactPayloadConstraints, "alter table memory_facts", "011 memory fact payload table");
assertIncludes(memoryFactPayloadConstraints, "memory_facts_payload_direction_check", "011 direction constraint");
assertIncludes(memoryFactPayloadConstraints, "memory_facts_payload_ownership_scope_check", "011 ownership scope constraint");
assertIncludes(memoryFactPayloadConstraints, "memory_facts_payload_money_shape_check", "011 money shape constraint");
assertIncludes(memoryFactPayloadConstraints, "payload->>'ownershipScope' in ('shared', 'member')", "011 shared/member ownership constraint");
assertIncludes(memoryFactPayloadConstraints, "create or replace function sayve_memory_fact_payload_constraint_status", "011 live payload constraint status rpc");
assertIncludes(memoryFactPayloadConstraints, "grant execute on function sayve_memory_fact_payload_constraint_status() to service_role", "011 payload constraint check is service-role callable");

assertIncludes(aiTelemetryConstraints, "ai_telemetry_events_phase_check", "012 phase constraint");
assertIncludes(aiTelemetryConstraints, "ai_telemetry_events_provider_check", "012 provider constraint");
assertIncludes(aiTelemetryConstraints, "ai_telemetry_events_status_check", "012 status constraint");
assertIncludes(aiTelemetryConstraints, "ai_telemetry_events_token_metrics_check", "012 token metrics constraint");
assertIncludes(aiTelemetryConstraints, "ai_telemetry_events_cost_latency_check", "012 cost latency constraint");
assertIncludes(aiTelemetryConstraints, "prompt_tokens is null or prompt_tokens >= 0", "012 non-negative prompt tokens");
assertIncludes(aiTelemetryConstraints, "estimated_cost_usd is null or estimated_cost_usd >= 0", "012 non-negative cost");
assertIncludes(aiTelemetryConstraints, "create or replace function sayve_ai_telemetry_constraint_status", "012 live telemetry constraint status rpc");
assertIncludes(aiTelemetryConstraints, "grant execute on function sayve_ai_telemetry_constraint_status() to service_role", "012 telemetry constraint check is service-role callable");

if (process.exitCode) {
  process.exit();
}

console.log("Supabase migrations verified.");
