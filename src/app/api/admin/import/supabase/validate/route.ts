import { canAccessFounderConsole } from "@/server/admin/founder-console";
import { adminJson, adminTokenFromRequest, unexpectedAdminErrorResponse } from "@/server/admin/http";
import { buildSupabaseImportPlanAsync } from "@/server/memory/supabase-export";
import { validateSupabaseImportPlan } from "@/server/memory/supabase-import-validator";

export async function GET(request: Request) {
  if (!canAccessFounderConsole(adminTokenFromRequest(request))) {
    return adminJson({ error: "Founder Console is not available." }, { status: 403 });
  }

  try {
    return adminJson(validateSupabaseImportPlan(await buildSupabaseImportPlanAsync()));
  } catch (error) {
    return unexpectedAdminErrorResponse(error);
  }
}
