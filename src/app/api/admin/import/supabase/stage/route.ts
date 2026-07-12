import { canAccessFounderConsole } from "@/server/admin/founder-console";
import { adminJson, adminTokenFromRequest, unexpectedAdminErrorResponse } from "@/server/admin/http";
import { stageCurrentMemoryForSupabase } from "@/server/memory/supabase-stage";

export async function POST(request: Request) {
  if (!canAccessFounderConsole(adminTokenFromRequest(request))) {
    return adminJson({ error: "Founder Console is not available." }, { status: 403 });
  }

  try {
    const result = await stageCurrentMemoryForSupabase();
    return adminJson(result, { status: result.staged || !result.configured ? 200 : 500 });
  } catch (error) {
    return unexpectedAdminErrorResponse(error);
  }
}
