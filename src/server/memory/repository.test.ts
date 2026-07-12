import { describe, expect, it } from "vitest";
import { assertProductionStorageBoundary, getMemoryRepository, requiresProductionStorageBoundary, withMemoryRepositoryRetry } from "./store";
import { createSupabaseMemoryRepository } from "./supabase-repository";

function createSnapshotSupabaseMock(rows = new Map<string, { state: unknown; revision: number }>()) {
  return {
    rows,
    client: {
      from() {
        const filters = new Map<string, unknown>();
        let operation: "select" | "insert" | "update" = "select";
        let insertRow: { household_id: string; state: unknown; revision?: number } | undefined;
        let updatePatch: { state: unknown; revision: number } | undefined;
        const query = {
          select() {
            return query;
          },
          insert(row: { household_id: string; state: unknown; revision?: number }) {
            operation = "insert";
            insertRow = row;
            return query;
          },
          update(patch: { state: unknown; revision: number }) {
            operation = "update";
            updatePatch = patch;
            return query;
          },
          eq(field: string, value: unknown) {
            filters.set(field, value);
            return query;
          },
          async maybeSingle() {
            const householdId = String(filters.get("household_id") ?? "");
            if (operation === "select") {
              return { data: rows.get(householdId) ?? null, error: null };
            }

            if (operation === "update") {
              const current = rows.get(householdId);
              if (!current || current.revision !== filters.get("revision")) return { data: null, error: null };
              rows.set(householdId, { state: updatePatch?.state, revision: updatePatch?.revision ?? current.revision });
              return { data: { revision: updatePatch?.revision ?? current.revision }, error: null };
            }

            return { data: null, error: null };
          },
          async single() {
            if (!insertRow) return { data: null, error: { message: "missing insert row" } };
            if (rows.has(insertRow.household_id)) return { data: null, error: { code: "23505", message: "duplicate snapshot" } };
            const revision = insertRow.revision ?? 1;
            rows.set(insertRow.household_id, { state: insertRow.state, revision });
            return { data: { revision }, error: null };
          }
        };
        return query;
      }
    }
  };
}

describe("Memory repository boundary", () => {
  it("exposes the local prototype store through sync and async repository interfaces", async () => {
    const repository = getMemoryRepository();
    const store = repository.read();
    const asyncStore = await repository.readAsync();

    expect(repository.mode).toBe("memory_only");
    expect(Array.isArray(store.captures)).toBe(true);
    expect(Array.isArray(store.memoryObjects)).toBe(true);
    expect(asyncStore).toBe(store);
  });

  it("throws a boundary violation when real auth mode is enabled without Supabase storage", () => {
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.SAYVE_ENFORCE_STORAGE_BOUNDARY_IN_TEST = "1";
    delete process.env.MEMORY_REPOSITORY;

    expect(requiresProductionStorageBoundary()).toBe(true);
    expect(() => assertProductionStorageBoundary()).toThrowError("production_storage_boundary_violation");
    expect(() => getMemoryRepository()).toThrowError("production_storage_boundary_violation");

    delete process.env.SUPABASE_AUTH_REQUIRED;
    delete process.env.SAYVE_ENFORCE_STORAGE_BOUNDARY_IN_TEST;
  });

  it("can persist a memory snapshot through the Supabase repository contract", async () => {
    const supabase = createSnapshotSupabaseMock();

    const repository = createSupabaseMemoryRepository({
      supabase: supabase.client as never,
      householdId: "00000000-0000-0000-0000-000000000001"
    });
    const store = await repository.readAsync();
    store.memoryObjects.push({
      id: "mem_test",
      householdId: "household_demo",
      domain: "financial",
      title: "Test memory",
      currentState: "active",
      confidence: 0.9,
      status: "auto_confirmed",
      sourceRefs: [],
      createdAt: "2026-07-06T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z"
    });

    await repository.commitAsync();

    const nextRepository = createSupabaseMemoryRepository({
      supabase: supabase.client as never,
      householdId: "00000000-0000-0000-0000-000000000001"
    });
    const nextStore = await nextRepository.readAsync();
    expect(nextStore.memoryObjects[0]?.id).toBe("mem_test");
    expect(supabase.rows.get("00000000-0000-0000-0000-000000000001")?.revision).toBe(1);
  });

  it("keeps Supabase snapshot repositories scoped by household id", async () => {
    const supabase = createSnapshotSupabaseMock();

    const householdA = createSupabaseMemoryRepository({ supabase: supabase.client as never, householdId: "household_a" });
    const householdB = createSupabaseMemoryRepository({ supabase: supabase.client as never, householdId: "household_b" });

    const storeA = await householdA.readAsync();
    storeA.captures.push({
      id: "cap_a",
      householdId: "household_a",
      sourceType: "text",
      rawText: "A",
      fileRefs: [],
      metadata: {},
      createdAt: "2026-07-06T00:00:00.000Z"
    });
    await householdA.commitAsync();

    const storeB = await householdB.readAsync();
    expect(storeB.captures).toHaveLength(0);
    storeB.captures.push({
      id: "cap_b",
      householdId: "household_b",
      sourceType: "text",
      rawText: "B",
      fileRefs: [],
      metadata: {},
      createdAt: "2026-07-06T00:00:00.000Z"
    });
    await householdB.commitAsync();

    expect((await householdA.readAsync()).captures.map((capture) => capture.id)).toEqual(["cap_a"]);
    expect((await householdB.readAsync()).captures.map((capture) => capture.id)).toEqual(["cap_b"]);
  });

  it("normalizes malformed Supabase snapshot state without crashing production reads", async () => {
    const supabase = createSnapshotSupabaseMock(
      new Map([
        [
          "household_a",
          {
            revision: 4,
            state: {
              captures: "not-an-array",
              memoryObjects: null,
              usage: { captures: 1 },
              aiTelemetry: [],
              categories: [{ id: "cat_1", householdId: "household_a", name: "School", createdBy: "user", createdAt: "2026-07-06T00:00:00.000Z" }]
            }
          }
        ]
      ])
    );

    const repository = createSupabaseMemoryRepository({ supabase: supabase.client as never, householdId: "household_a" });
    const store = await repository.readAsync();

    expect(store.captures).toEqual([]);
    expect(store.memoryObjects).toEqual([]);
    expect(store.usage).toEqual([]);
    expect(store.categories.map((category) => category.id)).toEqual(["cat_1"]);

    store.captures.push({
      id: "cap_after_malformed_snapshot",
      householdId: "household_a",
      sourceType: "text",
      rawText: "recovered",
      fileRefs: [],
      metadata: {},
      createdAt: "2026-07-06T00:00:00.000Z"
    });
    await repository.commitAsync();

    const latest = createSupabaseMemoryRepository({ supabase: supabase.client as never, householdId: "household_a" });
    expect((await latest.readAsync()).captures.map((capture) => capture.id)).toEqual(["cap_after_malformed_snapshot"]);
  });

  it("rejects stale Supabase snapshot commits instead of overwriting newer memory", async () => {
    const supabase = createSnapshotSupabaseMock(
      new Map([
        [
          "household_a",
          {
            revision: 1,
            state: {
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
            }
          }
        ]
      ])
    );
    const first = createSupabaseMemoryRepository({ supabase: supabase.client as never, householdId: "household_a" });
    const second = createSupabaseMemoryRepository({ supabase: supabase.client as never, householdId: "household_a" });

    (await first.readAsync()).captures.push({
      id: "cap_first",
      householdId: "household_a",
      sourceType: "text",
      rawText: "first",
      fileRefs: [],
      metadata: {},
      createdAt: "2026-07-06T00:00:00.000Z"
    });
    (await second.readAsync()).captures.push({
      id: "cap_second",
      householdId: "household_a",
      sourceType: "text",
      rawText: "second",
      fileRefs: [],
      metadata: {},
      createdAt: "2026-07-06T00:00:00.000Z"
    });

    await first.commitAsync();
    await expect(second.commitAsync()).rejects.toThrow("supabase_memory_repository_conflict");
    const latest = createSupabaseMemoryRepository({ supabase: supabase.client as never, householdId: "household_a" });
    expect((await latest.readAsync()).captures.map((capture) => capture.id)).toEqual(["cap_first"]);
  });

  it("treats concurrent first snapshot inserts as retryable repository conflicts", async () => {
    const supabase = createSnapshotSupabaseMock();
    const first = createSupabaseMemoryRepository({ supabase: supabase.client as never, householdId: "household_a" });
    const second = createSupabaseMemoryRepository({ supabase: supabase.client as never, householdId: "household_a" });

    (await first.readAsync()).captures.push({
      id: "cap_first",
      householdId: "household_a",
      sourceType: "text",
      rawText: "first",
      fileRefs: [],
      metadata: {},
      createdAt: "2026-07-06T00:00:00.000Z"
    });
    (await second.readAsync()).captures.push({
      id: "cap_second",
      householdId: "household_a",
      sourceType: "text",
      rawText: "second",
      fileRefs: [],
      metadata: {},
      createdAt: "2026-07-06T00:00:00.000Z"
    });

    await first.commitAsync();
    await expect(second.commitAsync()).rejects.toThrow("supabase_memory_repository_conflict");
    const latest = createSupabaseMemoryRepository({ supabase: supabase.client as never, householdId: "household_a" });
    expect((await latest.readAsync()).captures.map((capture) => capture.id)).toEqual(["cap_first"]);
  });

  it("retries one stale repository conflict for household write operations", async () => {
    let attempts = 0;

    const result = await withMemoryRepositoryRetry("household_a", async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("supabase_memory_repository_conflict");
      return "committed";
    });

    expect(result).toBe("committed");
    expect(attempts).toBe(2);
  });
});
