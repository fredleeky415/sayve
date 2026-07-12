import { canAccessFounderConsole } from "@/server/admin/founder-console";
import { adminJson, adminTokenFromRequest, unexpectedAdminErrorResponse } from "@/server/admin/http";
import { checkSupabaseSchema } from "@/server/memory/supabase-schema-check";

export async function GET(request: Request) {
  if (!canAccessFounderConsole(adminTokenFromRequest(request))) {
    return adminJson({ error: "Founder Console is not available." }, { status: 403 });
  }

  try {
    const result = await checkSupabaseSchema();
    return adminJson(result, { status: result.ok || !result.configured ? 200 : 500 });
  } catch (error) {
    return unexpectedAdminErrorResponse(error);
  }
}
