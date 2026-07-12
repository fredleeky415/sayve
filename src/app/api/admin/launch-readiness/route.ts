import { canAccessFounderConsole } from "@/server/admin/founder-console";
import { adminJson, adminTokenFromRequest } from "@/server/admin/http";
import { getLaunchReadinessReport } from "@/server/admin/launch-readiness";

export async function GET(request: Request) {
  if (!canAccessFounderConsole(adminTokenFromRequest(request))) {
    return adminJson({ error: "Unauthorized" }, { status: 401 });
  }

  return adminJson(await getLaunchReadinessReport());
}
