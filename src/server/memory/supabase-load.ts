import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSupabaseImportPlanAsync, type SupabaseImportPlan } from "@/server/memory/supabase-export";
import { validateSupabaseImportPlan, type ValidationResult } from "@/server/memory/supabase-import-validator";
import { createSupabaseServiceClient } from "@/server/supabase/service-client";
import { dryRunSupabaseImport } from "@/server/memory/supabase-dry-run";

type Row = Record<string, unknown>;

type SupabaseLoadClient = Pick<SupabaseClient, "from">;

export type SupabaseLoadResult = {
  configured: boolean;
  loaded: boolean;
  requiresConfirmation?: boolean;
  planSignature?: string;
  validation?: ValidationResult;
  tableCounts?: Record<string, number>;
  insertedCounts?: Record<string, number>;
  existingCounts?: Record<string, number>;
  error?: string;
};

type IdMaps = {
  households: Map<string, string>;
  categories: Map<string, string>;
  captures: Map<string, string>;
  memoryObjects: Map<string, string>;
  interpretations: Map<string, string>;
  facts: Map<string, string>;
  contexts: Map<string, string>;
  relationships: Map<string, string>;
  revisions: Map<string, string>;
  insights: Map<string, string>;
  conversations: Map<string, string>;
  usage: Map<string, string>;
  telemetry: Map<string, string>;
};

const RELATIONSHIP_TARGETS: Record<string, keyof IdMaps> = {
  capture: "captures",
  memory: "memoryObjects",
  fact: "facts",
  context: "contexts",
  insight: "insights",
  conversation: "conversations"
};

function rowsFor(plan: SupabaseImportPlan, table: string): Row[] {
  return (plan.tables[table] ?? []) as Row[];
}

function externalId(row: Row): string {
  return String(row.external_id ?? "");
}

function referencedId(map: Map<string, string>, value: unknown, table: string, externalIdForError: string): string {
  const id = map.get(String(value ?? ""));
  if (!id) throw new Error(`Could not resolve ${table} reference ${String(value ?? "(empty)")} for ${externalIdForError}.`);
  return id;
}

async function selectExistingIds(client: SupabaseLoadClient, table: string, externalIds: string[]): Promise<Map<string, string>> {
  const ids = externalIds.filter(Boolean);
  if (ids.length === 0) return new Map();

  const { data, error } = await client.from(table).select("id,external_id").in("external_id", ids);
  if (error) throw new Error(`Could not query existing ${table} rows. ${error.message}`);

  return new Map(
    ((data ?? []) as Array<{ id?: string; external_id?: string }>)
      .filter((row) => row.id && row.external_id)
      .map((row) => [String(row.external_id), String(row.id)])
  );
}

async function loadRows(input: {
  client: SupabaseLoadClient;
  table: string;
  rows: Row[];
  toDbRow: (row: Row) => Row;
  insertedCounts: Record<string, number>;
  existingCounts: Record<string, number>;
}): Promise<Map<string, string>> {
  const externalIds = input.rows.map(externalId).filter(Boolean);
  const existing = await selectExistingIds(input.client, input.table, externalIds);
  const rowsToInsert = input.rows.filter((row) => !existing.has(externalId(row)));

  input.existingCounts[input.table] = existing.size;
  input.insertedCounts[input.table] = rowsToInsert.length;

  if (rowsToInsert.length === 0) return existing;

  const { data, error } = await input.client
    .from(input.table)
    .insert(rowsToInsert.map(input.toDbRow))
    .select("id,external_id");
  if (error) throw new Error(`Could not insert ${input.table} rows. ${error.message}`);

  for (const row of (data ?? []) as Array<{ id?: string; external_id?: string }>) {
    if (row.id && row.external_id) existing.set(String(row.external_id), String(row.id));
  }

  return existing;
}

function baseHouseholdRow(row: Row, households: Map<string, string>) {
  const id = externalId(row);
  return {
    ...row,
    household_id: referencedId(households, row.household_external_id, "households", id)
  };
}

function dropExternalReferences(row: Row, fields: string[]): Row {
  const copy = { ...row };
  for (const field of fields) delete copy[field];
  return copy;
}

export async function applySupabaseImportPlan(
  plan: SupabaseImportPlan,
  client: SupabaseLoadClient = createSupabaseServiceClient() as SupabaseLoadClient
): Promise<SupabaseLoadResult> {
  if (!client) {
    return {
      configured: false,
      loaded: false,
      error: "Supabase service env is not configured."
    };
  }

  const validation = validateSupabaseImportPlan(plan);
  if (!validation.valid) {
    return {
      configured: true,
      loaded: false,
      validation,
      tableCounts: validation.tableCounts,
      error: "Import plan failed validation."
    };
  }

  const insertedCounts: Record<string, number> = {};
  const existingCounts: Record<string, number> = {};

  try {
    const maps: IdMaps = {
      households: await loadRows({
        client,
        table: "households",
        rows: rowsFor(plan, "households"),
        insertedCounts,
        existingCounts,
        toDbRow: (row) => ({
          external_id: row.external_id,
          name: row.name,
          default_currency: row.default_currency,
          locale: row.locale
        })
      }),
      categories: new Map(),
      captures: new Map(),
      memoryObjects: new Map(),
      interpretations: new Map(),
      facts: new Map(),
      contexts: new Map(),
      relationships: new Map(),
      revisions: new Map(),
      insights: new Map(),
      conversations: new Map(),
      usage: new Map(),
      telemetry: new Map()
    };

    maps.categories = await loadRows({
      client,
      table: "household_categories",
      rows: rowsFor(plan, "household_categories"),
      insertedCounts,
      existingCounts,
      toDbRow: (row) => dropExternalReferences(baseHouseholdRow(row, maps.households), ["household_external_id"])
    });

    maps.captures = await loadRows({
      client,
      table: "captures",
      rows: rowsFor(plan, "captures"),
      insertedCounts,
      existingCounts,
      toDbRow: (row) => dropExternalReferences(baseHouseholdRow(row, maps.households), ["household_external_id"])
    });

    maps.memoryObjects = await loadRows({
      client,
      table: "memory_objects",
      rows: rowsFor(plan, "memory_objects"),
      insertedCounts,
      existingCounts,
      toDbRow: (row) => dropExternalReferences(baseHouseholdRow(row, maps.households), ["household_external_id"])
    });

    maps.interpretations = await loadRows({
      client,
      table: "memory_interpretations",
      rows: rowsFor(plan, "memory_interpretations"),
      insertedCounts,
      existingCounts,
      toDbRow: (row) => {
        const id = externalId(row);
        return {
          ...dropExternalReferences(row, ["memory_object_external_id"]),
          memory_object_id: referencedId(maps.memoryObjects, row.memory_object_external_id, "memory_objects", id)
        };
      }
    });

    maps.facts = await loadRows({
      client,
      table: "memory_facts",
      rows: rowsFor(plan, "memory_facts"),
      insertedCounts,
      existingCounts,
      toDbRow: (row) => {
        const id = externalId(row);
        return {
          ...dropExternalReferences(baseHouseholdRow(row, maps.households), ["household_external_id", "memory_object_external_id"]),
          memory_object_id: referencedId(maps.memoryObjects, row.memory_object_external_id, "memory_objects", id)
        };
      }
    });

    maps.contexts = await loadRows({
      client,
      table: "household_context",
      rows: rowsFor(plan, "household_context"),
      insertedCounts,
      existingCounts,
      toDbRow: (row) => dropExternalReferences(baseHouseholdRow(row, maps.households), ["household_external_id"])
    });

    maps.insights = await loadRows({
      client,
      table: "insights",
      rows: rowsFor(plan, "insights"),
      insertedCounts,
      existingCounts,
      toDbRow: (row) => dropExternalReferences(baseHouseholdRow(row, maps.households), ["household_external_id"])
    });

    maps.conversations = await loadRows({
      client,
      table: "conversation_messages",
      rows: rowsFor(plan, "conversation_messages"),
      insertedCounts,
      existingCounts,
      toDbRow: (row) => dropExternalReferences(baseHouseholdRow(row, maps.households), ["household_external_id"])
    });

    maps.relationships = await loadRows({
      client,
      table: "memory_relationships",
      rows: rowsFor(plan, "memory_relationships"),
      insertedCounts,
      existingCounts,
      toDbRow: (row) => {
        const id = externalId(row);
        const fromMapKey = RELATIONSHIP_TARGETS[String(row.from_type ?? "")];
        const toMapKey = RELATIONSHIP_TARGETS[String(row.to_type ?? "")];
        if (!fromMapKey || !toMapKey) throw new Error(`Unsupported relationship target for ${id}.`);
        return {
          ...dropExternalReferences(baseHouseholdRow(row, maps.households), ["household_external_id", "from_external_id", "to_external_id"]),
          from_id: referencedId(maps[fromMapKey], row.from_external_id, String(row.from_type), id),
          to_id: referencedId(maps[toMapKey], row.to_external_id, String(row.to_type), id)
        };
      }
    });

    maps.revisions = await loadRows({
      client,
      table: "memory_revisions",
      rows: rowsFor(plan, "memory_revisions"),
      insertedCounts,
      existingCounts,
      toDbRow: (row) => {
        const id = externalId(row);
        return {
          ...dropExternalReferences(baseHouseholdRow(row, maps.households), ["household_external_id", "memory_object_external_id"]),
          memory_object_id: referencedId(maps.memoryObjects, row.memory_object_external_id, "memory_objects", id)
        };
      }
    });

    maps.usage = await loadRows({
      client,
      table: "usage_buckets",
      rows: rowsFor(plan, "usage_buckets"),
      insertedCounts,
      existingCounts,
      toDbRow: (row) => dropExternalReferences(baseHouseholdRow(row, maps.households), ["household_external_id"])
    });

    maps.telemetry = await loadRows({
      client,
      table: "ai_telemetry_events",
      rows: rowsFor(plan, "ai_telemetry_events"),
      insertedCounts,
      existingCounts,
      toDbRow: (row) => {
        const id = externalId(row);
        return {
          ...dropExternalReferences(baseHouseholdRow(row, maps.households), [
            "household_external_id",
            "memory_object_external_id",
            "capture_external_id",
            "conversation_message_external_id"
          ]),
          memory_object_id: row.memory_object_external_id
            ? referencedId(maps.memoryObjects, row.memory_object_external_id, "memory_objects", id)
            : undefined,
          capture_id: row.capture_external_id ? referencedId(maps.captures, row.capture_external_id, "captures", id) : undefined,
          conversation_message_id: row.conversation_message_external_id
            ? referencedId(maps.conversations, row.conversation_message_external_id, "conversation_messages", id)
            : undefined
        };
      }
    });
  } catch (error) {
    return {
      configured: true,
      loaded: false,
      validation,
      tableCounts: validation.tableCounts,
      insertedCounts,
      existingCounts,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  return {
    configured: true,
    loaded: true,
    validation,
    tableCounts: validation.tableCounts,
    insertedCounts,
    existingCounts
  };
}

export async function loadCurrentMemoryIntoSupabase(input?: {
  confirmLoad?: boolean;
  planSignature?: string;
}): Promise<SupabaseLoadResult> {
  const plan = await buildSupabaseImportPlanAsync();
  const dryRun = await dryRunSupabaseImport(plan);

  if (!input?.confirmLoad) {
    return {
      configured: dryRun.configured,
      loaded: false,
      requiresConfirmation: true,
      planSignature: dryRun.planSignature,
      validation: dryRun.validation,
      tableCounts: dryRun.validation.tableCounts,
      error: "Founder import load requires confirmLoad=true with the latest dry-run planSignature."
    };
  }

  if (!input.planSignature || input.planSignature !== dryRun.planSignature) {
    return {
      configured: dryRun.configured,
      loaded: false,
      requiresConfirmation: true,
      planSignature: dryRun.planSignature,
      validation: dryRun.validation,
      tableCounts: dryRun.validation.tableCounts,
      error: "Import plan changed or was not confirmed. Re-run dry-run and retry load with the latest planSignature."
    };
  }

  const result = await applySupabaseImportPlan(plan);
  return {
    ...result,
    planSignature: dryRun.planSignature
  };
}
