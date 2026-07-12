-- Harden AI telemetry rows because Founder Console cost, model mix, and latency
-- analytics depend on these values being internally consistent.

alter table ai_telemetry_events
  drop constraint if exists ai_telemetry_events_phase_check,
  drop constraint if exists ai_telemetry_events_provider_check,
  drop constraint if exists ai_telemetry_events_status_check,
  drop constraint if exists ai_telemetry_events_token_metrics_check,
  drop constraint if exists ai_telemetry_events_cost_latency_check;

alter table ai_telemetry_events
  add constraint ai_telemetry_events_phase_check
    check (phase in ('capture_interpretation', 'receipt_vision', 'speech_to_text', 'conversation_answer', 'memory_evolution', 'queued_without_ai')),
  add constraint ai_telemetry_events_provider_check
    check (provider in ('openai', 'heuristic', 'system')),
  add constraint ai_telemetry_events_status_check
    check (status in ('success', 'fallback', 'limited', 'error')),
  add constraint ai_telemetry_events_token_metrics_check
    check (
      (prompt_tokens is null or prompt_tokens >= 0)
      and (completion_tokens is null or completion_tokens >= 0)
      and (total_tokens is null or total_tokens >= 0)
    ),
  add constraint ai_telemetry_events_cost_latency_check
    check (
      (estimated_cost_usd is null or estimated_cost_usd >= 0)
      and (duration_ms is null or duration_ms >= 0)
    );

create or replace function sayve_ai_telemetry_constraint_status()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'phaseConstraintCount', count(*) filter (where c.conname = 'ai_telemetry_events_phase_check'),
    'providerConstraintCount', count(*) filter (where c.conname = 'ai_telemetry_events_provider_check'),
    'statusConstraintCount', count(*) filter (where c.conname = 'ai_telemetry_events_status_check'),
    'tokenMetricsConstraintCount', count(*) filter (where c.conname = 'ai_telemetry_events_token_metrics_check'),
    'costLatencyConstraintCount', count(*) filter (where c.conname = 'ai_telemetry_events_cost_latency_check')
  )
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'ai_telemetry_events';
$$;

revoke all on function sayve_ai_telemetry_constraint_status() from public;
grant execute on function sayve_ai_telemetry_constraint_status() to service_role;
