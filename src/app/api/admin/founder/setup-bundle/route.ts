import { canAccessFounderConsole, getFounderSetupBundle } from "@/server/admin/founder-console";
import { adminJson, adminTokenFromRequest } from "@/server/admin/http";
import { getLaunchReadinessReport } from "@/server/admin/launch-readiness";

export async function GET(request: Request) {
  if (!canAccessFounderConsole(adminTokenFromRequest(request))) {
    return adminJson({ error: "Founder Console is not available." }, { status: 403 });
  }

  const launchReadiness = await getLaunchReadinessReport();

  return adminJson(
    await getFounderSetupBundle({
      configReadyForPrivateBeta: launchReadiness.configReadyForPrivateBeta,
      liveSmokeVerified: launchReadiness.liveSmokeVerified,
      readyForPublicLaunch: launchReadiness.readyForPublicLaunch
    }, launchReadiness.checks)
  );
}
