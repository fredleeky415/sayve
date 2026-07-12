import { canAccessFounderConsole } from "@/server/admin/founder-console";
import { adminJson, adminTokenFromRequest, unexpectedAdminErrorResponse } from "@/server/admin/http";
import { loadCurrentMemoryIntoSupabase } from "@/server/memory/supabase-load";

export async function POST(request: Request) {
  if (!canAccessFounderConsole(adminTokenFromRequest(request))) {
    return adminJson({ error: "Founder Console is not available." }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      confirmLoad?: boolean;
      planSignature?: string;
    };
    const result = await loadCurrentMemoryIntoSupabase(body);
    if (result.requiresConfirmation) {
      return adminJson(result, { status: 409 });
    }
    return adminJson(result, { status: result.loaded || !result.configured ? 200 : 500 });
  } catch (error) {
    return unexpectedAdminErrorResponse(error);
  }
}
