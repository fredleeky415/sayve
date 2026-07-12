import type {
  Capture,
  CaptureSource,
  ConversationMessage,
  HouseholdContext,
  Insight,
  MemoryFact,
  MemoryInterpretation,
  MemoryObject,
  MemoryRelationship,
  MemoryRevision
} from "@/shared/memory/types";
import { createSupabaseMemoryRepository } from "@/server/memory/supabase-repository";
import { createSupabaseServiceClient } from "@/server/supabase/service-client";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type PrototypeUsageBucket = {
  householdId: string;
  month: string;
  captures: number;
  receiptCaptures: number;
  voiceCaptures: number;
  conversationTurns: number;
  dashboardViews: number;
  aiInterpretations: number;
  limitEvents: Array<{
    reason: string;
    createdAt: string;
  }>;
};

export type AiTelemetryEvent = {
  id: string;
  householdId: string;
  phase:
    | "capture_interpretation"
    | "receipt_vision"
    | "speech_to_text"
    | "conversation_answer"
    | "memory_evolution"
    | "queued_without_ai";
  model: string;
  provider: "openai" | "heuristic" | "system";
  sourceType?: CaptureSource;
  memoryObjectId?: string;
  captureId?: string;
  conversationMessageId?: string;
  status: "success" | "fallback" | "limited" | "error";
  confidence?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type HouseholdCategory = {
  id: string;
  householdId: string;
  name: string;
  color?: string;
  createdBy: "user" | "system";
  createdByUserId?: string;
  createdAt: string;
  archivedAt?: string;
};

export type MemoryStoreState = {
  captures: Capture[];
  memoryObjects: MemoryObject[];
  interpretations: MemoryInterpretation[];
  facts: MemoryFact[];
  contexts: HouseholdContext[];
  relationships: MemoryRelationship[];
  revisions: MemoryRevision[];
  insights: Insight[];
  conversationMessages: ConversationMessage[];
  usage: PrototypeUsageBucket[];
  aiTelemetry: AiTelemetryEvent[];
  categories: HouseholdCategory[];
};

const initialState: MemoryStoreState = {
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

const globalState = globalThis as typeof globalThis & {
  familyFinancialMemoryStore?: MemoryStoreState;
  familyFinancialMemoryRepository?: {
    key: string;
    repository: MemoryRepository;
  };
};

export type MemoryRepositoryMode = "local_file" | "memory_only" | "supabase";

export type MemoryRepository = {
  mode: MemoryRepositoryMode;
  read(): MemoryStoreState;
  commit(): void;
  reset(): void;
  readAsync(): Promise<MemoryStoreState>;
  commitAsync(): Promise<void>;
  resetAsync(): Promise<void>;
};

const MAX_REPOSITORY_WRITE_ATTEMPTS = 2;

function configuredRepositoryMode(): MemoryRepositoryMode {
  if (process.env.MEMORY_REPOSITORY === "supabase") return "supabase";
  return persistenceEnabled() ? "local_file" : "memory_only";
}

export function requiresProductionStorageBoundary(): boolean {
  return process.env.SUPABASE_AUTH_REQUIRED === "1";
}

export function assertProductionStorageBoundary(): void {
  if (!requiresProductionStorageBoundary()) return;
  if (process.env.NODE_ENV === "test" && process.env.SAYVE_ENFORCE_STORAGE_BOUNDARY_IN_TEST !== "1") return;
  if (configuredRepositoryMode() !== "supabase") {
    throw new Error("production_storage_boundary_violation");
  }
}

function storeFilePath(): string {
  return process.env.MEMORY_STORE_FILE ?? join(process.cwd(), ".data", "memory-store.json");
}

function persistenceEnabled(): boolean {
  return process.env.MEMORY_STORE_DISABLED !== "1" && process.env.NODE_ENV !== "test";
}

function readPersistedStore(): MemoryStoreState | undefined {
  if (!persistenceEnabled()) return undefined;

  const filePath = storeFilePath();
  if (!existsSync(filePath)) return undefined;

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<MemoryStoreState>;
    return {
      captures: parsed.captures ?? [],
      memoryObjects: parsed.memoryObjects ?? [],
      interpretations: parsed.interpretations ?? [],
      facts: parsed.facts ?? [],
      contexts: parsed.contexts ?? [],
      relationships: parsed.relationships ?? [],
      revisions: parsed.revisions ?? [],
      insights: parsed.insights ?? [],
      conversationMessages: parsed.conversationMessages ?? [],
      usage: (parsed.usage ?? []).map((bucket) => ({ ...bucket, dashboardViews: bucket.dashboardViews ?? 0 })),
      aiTelemetry: parsed.aiTelemetry ?? [],
      categories: parsed.categories ?? []
    };
  } catch {
    return undefined;
  }
}

export function getStore(): MemoryStoreState {
  if (!globalState.familyFinancialMemoryStore) {
    globalState.familyFinancialMemoryStore = readPersistedStore() ?? structuredClone(initialState);
  }

  return globalState.familyFinancialMemoryStore;
}

export function saveStore(): void {
  if (!persistenceEnabled()) return;

  const filePath = storeFilePath();
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(getStore(), null, 2)}\n`);
}

export function resetStore(): void {
  globalState.familyFinancialMemoryStore = structuredClone(initialState);
  saveStore();
}

export function getMemoryRepository(householdIdOverride?: string): MemoryRepository {
  assertProductionStorageBoundary();

  if (configuredRepositoryMode() === "supabase") {
    const supabase = createSupabaseServiceClient();
    const householdId = householdIdOverride ?? process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID;
    if (!supabase || !householdId) {
      throw new Error("supabase_memory_repository_not_configured");
    }
    const key = `supabase:${householdId}`;
    if (globalState.familyFinancialMemoryRepository?.key === key) {
      return globalState.familyFinancialMemoryRepository.repository;
    }
    const repository = createSupabaseMemoryRepository({ supabase, householdId });
    globalState.familyFinancialMemoryRepository = { key, repository };
    return repository;
  }

  return {
    mode: configuredRepositoryMode(),
    read: getStore,
    commit: saveStore,
    reset: resetStore,
    readAsync: async () => getStore(),
    commitAsync: async () => saveStore(),
    resetAsync: async () => resetStore()
  };
}

export function invalidateMemoryRepository(householdIdOverride?: string): void {
  if (process.env.MEMORY_REPOSITORY !== "supabase") return;

  const householdId = householdIdOverride ?? process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID;
  const key = householdId ? `supabase:${householdId}` : undefined;
  if (!key || globalState.familyFinancialMemoryRepository?.key === key) {
    globalState.familyFinancialMemoryRepository = undefined;
  }
}

export function isMemoryRepositoryConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("supabase_memory_repository_conflict");
}

export async function withMemoryRepositoryRetry<T>(householdId: string, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_REPOSITORY_WRITE_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isMemoryRepositoryConflict(error) || attempt === MAX_REPOSITORY_WRITE_ATTEMPTS) break;
      invalidateMemoryRepository(householdId);
    }
  }
  throw lastError;
}

export function emptyUsageBucket(householdId: string, month: string): PrototypeUsageBucket {
  return {
    householdId,
    month,
    captures: 0,
    receiptCaptures: 0,
    voiceCaptures: 0,
    conversationTurns: 0,
    dashboardViews: 0,
    aiInterpretations: 0,
    limitEvents: []
  };
}

export function captureUsageField(sourceType: CaptureSource): "receiptCaptures" | "voiceCaptures" | undefined {
  if (sourceType === "receipt") return "receiptCaptures";
  if (sourceType === "voice") return "voiceCaptures";
  return undefined;
}
