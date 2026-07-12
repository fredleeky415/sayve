import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationNotes = {
  "001_ai_native_memory_engine.sql": {
    requiredFor: "private_beta",
    purpose: "Base AI Native Memory schema across households, captures, facts, context, revisions, insights, invites, and telemetry."
  },
  "002_prototype_migration_path.sql": {
    requiredFor: "private_beta",
    purpose: "Prototype-to-Supabase migration path via external ids, usage buckets, and admin-only import batches."
  },
  "003_memory_store_snapshots.sql": {
    requiredFor: "private_beta",
    purpose: "Transitional Supabase JSONB snapshot repository so Sayve can run beyond the local demo."
  },
  "004_harden_memory_store_access.sql": {
    requiredFor: "private_beta",
    purpose: "Locks memory_store_snapshots to the server service role and exposes policy-count RPC proof."
  },
  "005_harden_household_role_policies.sql": {
    requiredFor: "private_beta",
    purpose: "Splits household read vs writer roles so owner/member writes and viewer reads are enforced."
  },
  "006_harden_invite_access.sql": {
    requiredFor: "private_beta",
    purpose: "Moves invite storage behind the server service role and keeps browser clients out of the table."
  },
  "007_harden_memory_interpretation_writer_policy.sql": {
    requiredFor: "private_beta",
    purpose: "Completes writer-only interpretation policies and extends live role-policy verification."
  },
  "008_atomic_invite_acceptance.sql": {
    requiredFor: "private_beta",
    purpose: "Adds atomic invite acceptance RPC so partner onboarding is idempotent and single-use."
  },
  "009_revision_actor_attribution.sql": {
    requiredFor: "public_launch",
    purpose: "Preserves which logged-in member corrected a memory for auditability and AI learning."
  },
  "010_category_actor_attribution.sql": {
    requiredFor: "public_launch",
    purpose: "Preserves which household member taught Sayve a custom category."
  },
  "011_harden_memory_fact_payload_constraints.sql": {
    requiredFor: "public_launch",
    purpose: "Adds Postgres constraints around fact direction, money shape, and shared-vs-member ownership."
  },
  "012_harden_ai_telemetry_constraints.sql": {
    requiredFor: "public_launch",
    purpose: "Hardens telemetry shape so tokens, cost, latency, provider, and phase remain analyzable."
  }
};

export function getMigrationInventory(cwd = process.cwd()) {
  const migrationDir = join(cwd, "supabase", "migrations");

  return readdirSync(migrationDir)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b))
    .map((file, index) => {
      const metadata = migrationNotes[file] ?? {
        requiredFor: "public_launch",
        purpose: "Custom migration; review before rollout."
      };
      const sql = readFileSync(join(migrationDir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");

      return {
        line: index + 1,
        version: file.slice(0, 3),
        file,
        requiredFor: metadata.requiredFor,
        checksum,
        shortChecksum: checksum.slice(0, 12),
        purpose: metadata.purpose
      };
    });
}
