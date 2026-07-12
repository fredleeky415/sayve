import { getMemoryRepository, type MemoryStoreState } from "@/server/memory/store";

const DEFAULT_HOUSEHOLD_ID = "household_demo";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;
}

export type SupabaseImportPlan = {
  formatVersion: "sayve.supabase-import-plan.v1";
  generatedAt: string;
  source: "local_memory_store";
  notes: string[];
  loadOrder: string[];
  externalIdStrategy: {
    localIdsRemainInExternalId: boolean;
    foreignKeysMustBeResolvedByExternalId: boolean;
  };
  tables: Record<string, unknown[]>;
};

function householdRows(store: MemoryStoreState) {
  const householdIds = new Set<string>([DEFAULT_HOUSEHOLD_ID]);
  for (const collection of [
    store.captures,
    store.memoryObjects,
    store.facts,
    store.contexts,
    store.relationships,
    store.revisions,
    store.insights,
    store.conversationMessages,
    store.usage,
    store.aiTelemetry,
    store.categories
  ]) {
    for (const row of collection) householdIds.add(row.householdId);
  }

  return [...householdIds].map((householdId) => ({
    external_id: householdId,
    name: householdId === DEFAULT_HOUSEHOLD_ID ? "Demo Household" : householdId,
    default_currency: "HKD",
    locale: "zh-Hant-HK"
  }));
}

export function buildSupabaseImportPlan(store = getMemoryRepository().read()): SupabaseImportPlan {
  return {
    formatVersion: "sayve.supabase-import-plan.v1",
    generatedAt: new Date().toISOString(),
    source: "local_memory_store",
    notes: [
      "This is an import plan, not direct SQL insert data.",
      "Prototype ids such as cap_xxx and mem_xxx should be stored as external_id.",
      "A loader should resolve *_external_id fields into Supabase uuid foreign keys.",
      "Facts remain append-only; corrections should import as revisions, not fact overwrites."
    ],
    loadOrder: [
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
      "usage_buckets",
      "ai_telemetry_events"
    ],
    externalIdStrategy: {
      localIdsRemainInExternalId: true,
      foreignKeysMustBeResolvedByExternalId: true
    },
    tables: {
      households: householdRows(store),
      household_categories: store.categories.map((category) => ({
        external_id: category.id,
        household_external_id: category.householdId,
        name: category.name,
        color: category.color,
        created_by: category.createdBy,
        created_by_user_id: uuidOrUndefined(category.createdByUserId),
        archived_at: category.archivedAt,
        created_at: category.createdAt
      })),
      captures: store.captures.map((capture) => ({
        external_id: capture.id,
        household_external_id: capture.householdId,
        source_type: capture.sourceType,
        raw_text: capture.rawText,
        transcript: capture.transcript,
        file_refs: capture.fileRefs,
        created_by: uuidOrUndefined(capture.createdBy),
        metadata: capture.metadata,
        created_at: capture.createdAt
      })),
      memory_objects: store.memoryObjects.map((memory) => ({
        external_id: memory.id,
        household_external_id: memory.householdId,
        domain: memory.domain,
        title: memory.title,
        current_state: memory.currentState,
        confidence: memory.confidence,
        status: memory.status,
        source_refs: memory.sourceRefs,
        created_at: memory.createdAt,
        updated_at: memory.updatedAt
      })),
      memory_interpretations: store.interpretations.map((interpretation) => ({
        external_id: interpretation.id,
        memory_object_external_id: interpretation.memoryObjectId,
        model: interpretation.model,
        prompt_version: interpretation.promptVersion,
        intent: interpretation.intent,
        structured_output: interpretation.structuredOutput,
        confidence: interpretation.confidence,
        confidence_band: interpretation.confidenceBand,
        reasoning_summary: interpretation.reasoningSummary,
        source_refs: interpretation.sourceRefs,
        created_at: interpretation.createdAt
      })),
      memory_facts: store.facts.map((fact) => ({
        external_id: fact.id,
        household_external_id: fact.householdId,
        memory_object_external_id: fact.memoryObjectId,
        domain: fact.domain,
        payload: fact.payload,
        source_refs: fact.sourceRefs,
        immutable: fact.immutable,
        created_at: fact.createdAt
      })),
      household_context: store.contexts.map((context) => ({
        external_id: context.id,
        household_external_id: context.householdId,
        domain: context.domain,
        subject: context.subject,
        state: context.state,
        current_state: context.currentState,
        confidence: context.confidence,
        source_refs: context.sourceRefs,
        effective_from: context.effectiveFrom,
        updated_at: context.updatedAt
      })),
      memory_relationships: store.relationships.map((relationship) => ({
        external_id: relationship.id,
        household_external_id: relationship.householdId,
        from_type: relationship.fromType,
        from_external_id: relationship.fromId,
        to_type: relationship.toType,
        to_external_id: relationship.toId,
        relationship_type: relationship.relationshipType,
        confidence: relationship.confidence,
        reason: relationship.reason,
        created_at: relationship.createdAt
      })),
      memory_revisions: store.revisions.map((revision) => ({
        external_id: revision.id,
        household_external_id: revision.householdId,
        memory_object_external_id: revision.memoryObjectId,
        revision_type: revision.revisionType,
        actor: revision.actor,
        actor_user_id: uuidOrUndefined(revision.actorUserId ?? revision.diff.actorUserId),
        reason: revision.reason,
        diff: revision.diff,
        created_at: revision.createdAt
      })),
      insights: store.insights.map((insight) => ({
        external_id: insight.id,
        household_external_id: insight.householdId,
        severity: insight.severity,
        title: insight.title,
        explanation: insight.explanation,
        source_refs: insight.sourceRefs,
        dismissed: insight.dismissed,
        created_at: insight.createdAt
      })),
      conversation_messages: store.conversationMessages.map((message) => ({
        external_id: message.id,
        household_external_id: message.householdId,
        role: message.role,
        content: message.content,
        created_by: uuidOrUndefined(message.createdBy),
        confidence: message.confidence,
        source_refs: message.sourceRefs,
        created_at: message.createdAt
      })),
      usage_buckets: store.usage.map((usage) => ({
        external_id: `${usage.householdId}_${usage.month}`,
        household_external_id: usage.householdId,
        month: usage.month,
        captures: usage.captures,
        receipt_captures: usage.receiptCaptures,
        voice_captures: usage.voiceCaptures,
        conversation_turns: usage.conversationTurns,
        dashboard_views: usage.dashboardViews,
        ai_interpretations: usage.aiInterpretations,
        limit_events: usage.limitEvents
      })),
      ai_telemetry_events: store.aiTelemetry.map((event) => ({
        external_id: event.id,
        household_external_id: event.householdId,
        phase: event.phase,
        model: event.model,
        provider: event.provider,
        source_type: event.sourceType,
        memory_object_external_id: event.memoryObjectId,
        capture_external_id: event.captureId,
        conversation_message_external_id: event.conversationMessageId,
        status: event.status,
        confidence: event.confidence,
        prompt_tokens: event.promptTokens,
        completion_tokens: event.completionTokens,
        total_tokens: event.totalTokens,
        estimated_cost_usd: event.estimatedCostUsd,
        duration_ms: event.durationMs,
        metadata: event.metadata,
        created_at: event.createdAt
      }))
    }
  };
}

export async function buildSupabaseImportPlanAsync(store?: MemoryStoreState): Promise<SupabaseImportPlan> {
  return buildSupabaseImportPlan(store ?? (await getMemoryRepository().readAsync()));
}
