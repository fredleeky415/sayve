import { canAccessFounderConsole, getFounderConsoleData } from "@/server/admin/founder-console";
import { adminJson, adminTokenFromRequest } from "@/server/admin/http";

export async function GET(request: Request) {
  if (!canAccessFounderConsole(adminTokenFromRequest(request))) {
    return adminJson({ error: "Founder Console is not available." }, { status: 403 });
  }

  return adminJson(await getFounderConsoleData());
}
