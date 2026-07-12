import { describe, expect, it } from "vitest";
import { readAppliedSupabaseMigrations } from "./supabase-applied-migrations";

function schemaClient(rows: Array<{ version?: string; name?: string }>) {
  return {
    schema: () => ({
      from: () => ({
        select: async () => ({
          data: rows,
          error: null
        })
      })
    })
  };
}

describe("readAppliedSupabaseMigrations", () => {
  it("marks inventory rows as applied when live migration history matches local files", async () => {
    const result = await readAppliedSupabaseMigrations(
      schemaClient([
        { version: "001", name: "ai_native_memory_engine" },
        { version: "002", name: "prototype_migration_path" },
        { version: "003", name: "memory_store_snapshots" },
        { version: "004", name: "harden_memory_store_access" },
        { version: "005", name: "harden_household_role_policies" },
        { version: "006", name: "harden_invite_access" },
        { version: "007", name: "harden_memory_interpretation_writer_policy" },
        { version: "008", name: "atomic_invite_acceptance" },
        { version: "009", name: "revision_actor_attribution" },
        { version: "010", name: "category_actor_attribution" },
        { version: "011", name: "harden_memory_fact_payload_constraints" },
        { version: "012", name: "harden_ai_telemetry_constraints" }
      ])
    );

    expect(result.configured).toBe(true);
    expect(result.accessible).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.missingVersions).toEqual([]);
    expect(result.rows.find((row) => row.version === "012")).toEqual(
      expect.objectContaining({
        file: "012_harden_ai_telemetry_constraints.sql",
        applied: true,
        remoteName: "harden_ai_telemetry_constraints"
      })
    );
  });

  it("surfaces missing or mismatched applied migrations", async () => {
    const result = await readAppliedSupabaseMigrations(
      schemaClient([
        { version: "001", name: "ai_native_memory_engine" },
        { version: "002", name: "prototype_migration_path" },
        { version: "011", name: "wrong_name" },
        { version: "999", name: "surprise_migration" }
      ])
    );

    expect(result.ok).toBe(false);
    expect(result.rows.find((row) => row.version === "011")).toEqual(
      expect.objectContaining({
        applied: false,
        remoteName: "wrong_name"
      })
    );
    expect(result.missingVersions).toContain("011");
    expect(result.missingVersions).toContain("012");
    expect(result.unexpectedRemoteVersions).toEqual(["999"]);
  });

  it("returns a readable issue when schema-qualified migration history is unavailable", async () => {
    const result = await readAppliedSupabaseMigrations({} as never);

    expect(result.configured).toBe(true);
    expect(result.accessible).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.issue).toContain("schema()");
  });
});
