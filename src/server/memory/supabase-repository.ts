import type { SupabaseClient } from "@supabase/supabase-js";
import type { MemoryRepository, MemoryStoreState } from "@/server/memory/store";

export type SupabaseMemoryRepositoryOptions = {
  supabase: SupabaseClient;
  householdId: string;
};

function emptyMemoryStoreState(): MemoryStoreState {
  return {
    captures: [],
    memoryObjects: [],
    interpretations: [],
    facts: [],
    contexts: [],
    relationships: [],
    revisions: [],
    insights: [],
    conversationMessages: [],
    usage: [],
    aiTelemetry: [],
    categories: []
  };
}

function arrayField<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeMemoryStoreState(value: unknown): MemoryStoreState {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<MemoryStoreState>) : {};
  const parsed = structuredClone(source);
  return {
    captures: arrayField(parsed.captures),
    memoryObjects: arrayField(parsed.memoryObjects),
    interpretations: arrayField(parsed.interpretations),
    facts: arrayField(parsed.facts),
    contexts: arrayField(parsed.contexts),
    relationships: arrayField(parsed.relationships),
    revisions: arrayField(parsed.revisions),
    insights: arrayField(parsed.insights),
    conversationMessages: arrayField(parsed.conversationMessages),
    usage: arrayField<MemoryStoreState["usage"][number]>(parsed.usage).map((bucket) => ({ ...bucket, dashboardViews: bucket.dashboardViews ?? 0 })),
    aiTelemetry: arrayField(parsed.aiTelemetry),
    categories: arrayField(parsed.categories)
  };
}

function isDuplicateSnapshotError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const message = error.message?.toLowerCase() ?? "";
  return error.code === "23505" || message.includes("duplicate") || message.includes("unique");
}

export function createSupabaseMemoryRepository(options: SupabaseMemoryRepositoryOptions): MemoryRepository {
  let current: MemoryStoreState | undefined;
  let snapshotLoaded = false;
  let snapshotExists = false;
  let snapshotRevision = 0;
  const notImplemented = () => {
    throw new Error("supabase_memory_repository_requires_async_methods");
  };

  const loadSnapshotMetadata = async () => {
    const { data, error } = await options.supabase
      .from("memory_store_snapshots")
      .select("revision")
      .eq("household_id", options.householdId)
      .maybeSingle();

    if (error) {
      throw new Error(`supabase_memory_repository_read_failed:${error.message}`);
    }

    snapshotLoaded = true;
    snapshotExists = Boolean(data);
    snapshotRevision = typeof data?.revision === "number" ? data.revision : 0;
  };

  const readAsync = async () => {
    if (current) return current;

    const { data, error } = await options.supabase
      .from("memory_store_snapshots")
      .select("state, revision")
      .eq("household_id", options.householdId)
      .maybeSingle();

    if (error) {
      throw new Error(`supabase_memory_repository_read_failed:${error.message}`);
    }

    snapshotLoaded = true;
    snapshotExists = Boolean(data);
    snapshotRevision = typeof data?.revision === "number" ? data.revision : 0;
    current = data?.state ? normalizeMemoryStoreState(data.state) : emptyMemoryStoreState();
    return current;
  };

  const commitAsync = async () => {
    if (!snapshotLoaded) await loadSnapshotMetadata();
    const state = current ?? emptyMemoryStoreState();
    const nextRevision = snapshotRevision + 1;
    const updatedAt = new Date().toISOString();

    if (!snapshotExists) {
      const { data, error } = await options.supabase
        .from("memory_store_snapshots")
        .insert({
          household_id: options.householdId,
          state,
          revision: nextRevision,
          updated_at: updatedAt
        })
        .select("revision")
        .single();

      if (error) {
        if (isDuplicateSnapshotError(error)) {
          throw new Error("supabase_memory_repository_conflict");
        }
        throw new Error(`supabase_memory_repository_commit_failed:${error.message}`);
      }

      snapshotExists = true;
      snapshotRevision = typeof data?.revision === "number" ? data.revision : nextRevision;
      return;
    }

    const { data, error } = await options.supabase
      .from("memory_store_snapshots")
      .update({
        state,
        revision: nextRevision,
        updated_at: updatedAt
      })
      .eq("household_id", options.householdId)
      .eq("revision", snapshotRevision)
      .select("revision")
      .maybeSingle();

    if (error) {
      throw new Error(`supabase_memory_repository_commit_failed:${error.message}`);
    }

    if (!data) {
      throw new Error("supabase_memory_repository_conflict");
    }

    snapshotRevision = typeof data.revision === "number" ? data.revision : nextRevision;
  };

  const resetAsync = async () => {
    current = emptyMemoryStoreState();
    await commitAsync();
  };

  return {
    mode: "supabase",
    read: notImplemented,
    commit: notImplemented,
    reset: notImplemented,
    readAsync,
    commitAsync,
    resetAsync
  };
}
