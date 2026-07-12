import { createSupabaseServiceClient } from "@/server/supabase/service-client";
import { getSupabaseMigrationInventory } from "@/server/memory/supabase-migration-inventory";

type SchemaCapableSupabaseClient = {
  schema?: (schema: string) => {
    from: (table: string) => {
      select: (columns: string) => PromiseLike<{ data: Array<{ version?: string; name?: string }> | null; error: { message: string } | null }>;
    };
  };
};

export type AppliedSupabaseMigrationRow = {
  version: string;
  file: string;
  expectedName: string;
  applied: boolean;
  remoteName: string;
  requiredFor: "private_beta" | "public_launch";
  checksum: string;
  shortChecksum: string;
  purpose: string;
};

export type AppliedSupabaseMigrationsResult = {
  configured: boolean;
  accessible: boolean;
  ok: boolean;
  rows: AppliedSupabaseMigrationRow[];
  missingVersions: string[];
  unexpectedRemoteVersions: string[];
  issue?: string;
};

function expectedMigrationName(file: string): string {
  return file.replace(/^\d{3}_/, "").replace(/\.sql$/i, "");
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

export async function readAppliedSupabaseMigrations(
  supabase: SchemaCapableSupabaseClient | undefined | null = createSupabaseServiceClient()
): Promise<AppliedSupabaseMigrationsResult> {
  const inventory = getSupabaseMigrationInventory();
  if (!supabase) {
    return {
      configured: false,
      accessible: false,
      ok: false,
      rows: inventory.map((row) => ({
        ...row,
        expectedName: expectedMigrationName(row.file),
        applied: false,
        remoteName: ""
      })),
      missingVersions: inventory.map((row) => row.version),
      unexpectedRemoteVersions: [],
      issue: "Supabase service env is not configured."
    };
  }

  if (typeof supabase.schema !== "function") {
    return {
      configured: true,
      accessible: false,
      ok: false,
      rows: inventory.map((row) => ({
        ...row,
        expectedName: expectedMigrationName(row.file),
        applied: false,
        remoteName: ""
      })),
      missingVersions: inventory.map((row) => row.version),
      unexpectedRemoteVersions: [],
      issue: "Supabase migration history is not accessible because the client does not expose schema() access."
    };
  }

  const { data, error } = await supabase.schema("supabase_migrations").from("schema_migrations").select("version,name");
  if (error) {
    return {
      configured: true,
      accessible: false,
      ok: false,
      rows: inventory.map((row) => ({
        ...row,
        expectedName: expectedMigrationName(row.file),
        applied: false,
        remoteName: ""
      })),
      missingVersions: inventory.map((row) => row.version),
      unexpectedRemoteVersions: [],
      issue: error.message
    };
  }

  const remoteByVersion = new Map<string, string>();
  for (const row of data ?? []) {
    const version = String(row.version ?? "").trim();
    const name = String(row.name ?? "").trim();
    if (version) remoteByVersion.set(version, name);
  }

  const rows = inventory.map((row) => {
    const remoteName = remoteByVersion.get(row.version) ?? "";
    const expectedName = expectedMigrationName(row.file);
    const applied = normalizeName(remoteName) === normalizeName(expectedName);
    return {
      ...row,
      expectedName,
      applied,
      remoteName
    };
  });

  const missingVersions = rows.filter((row) => !row.applied).map((row) => row.version);
  const expectedVersions = new Set(rows.map((row) => row.version));
  const unexpectedRemoteVersions = [...remoteByVersion.keys()].filter((version) => !expectedVersions.has(version)).sort();

  return {
    configured: true,
    accessible: true,
    ok: missingVersions.length === 0,
    rows,
    missingVersions,
    unexpectedRemoteVersions
  };
}
