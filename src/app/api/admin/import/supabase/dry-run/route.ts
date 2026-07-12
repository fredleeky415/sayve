import { canAccessFounderConsole } from "@/server/admin/founder-console";
import { adminJson, adminTokenFromRequest, unexpectedAdminErrorResponse } from "@/server/admin/http";
import { dryRunSupabaseImport } from "@/server/memory/supabase-dry-run";

export async function GET(request: Request) {
  if (!canAccessFounderConsole(adminTokenFromRequest(request))) {
    return adminJson({ error: "Founder Console is not available." }, { status: 403 });
  }

  try {
    return adminJson(await dryRunSupabaseImport());
  } catch (error) {
    return unexpectedAdminErrorResponse(error);
  }
}
