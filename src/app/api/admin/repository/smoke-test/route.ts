import { canAccessFounderConsole } from "@/server/admin/founder-console";
import { adminJson, adminTokenFromRequest } from "@/server/admin/http";
import { runRepositorySmokeTest } from "@/server/admin/repository-smoke-test";
import { readJsonObject } from "@/server/api/json";

export async function POST(request: Request) {
  if (!canAccessFounderConsole(adminTokenFromRequest(request))) {
    return adminJson({ error: "Founder Console is not available." }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await readJsonObject(request);
  } catch {
    return adminJson(
      {
        configured: true,
        ok: false,
        error: "invalid_json_body",
        message: "Repository smoke input must be a JSON object."
      },
      { status: 400 }
    );
  }

  const householdId = typeof body.householdId === "string" && body.householdId.trim() ? body.householdId.trim() : undefined;
  const result = await runRepositorySmokeTest({ householdId });
  return adminJson(result, { status: result.ok ? 200 : 500 });
}
