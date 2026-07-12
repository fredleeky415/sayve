import { canAccessFounderConsole } from "@/server/admin/founder-console";
import { adminJson, adminTokenFromRequest, unexpectedAdminErrorResponse } from "@/server/admin/http";
import { buildSupabaseImportPlanAsync } from "@/server/memory/supabase-export";

export async function GET(request: Request) {
  if (!canAccessFounderConsole(adminTokenFromRequest(request))) {
    return adminJson({ error: "Founder Console is not available." }, { status: 403 });
  }

  try {
    return adminJson(await buildSupabaseImportPlanAsync(), {
      headers: {
        "content-disposition": "attachment; filename=\"sayve-supabase-import-plan.json\""
      }
    });
  } catch (error) {
    return unexpectedAdminErrorResponse(error);
  }
}
