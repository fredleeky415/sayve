import { canAccessFounderConsole, getFounderExportRows, getFounderIntegrationBundle, getFounderLiveProofBundle, getFounderSetupBundle, rowsToCsv } from "@/server/admin/founder-console";
import { adminJson, adminResponse, adminTokenFromRequest } from "@/server/admin/http";
import { getLaunchReadinessReport } from "@/server/admin/launch-readiness";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!canAccessFounderConsole(adminTokenFromRequest(request))) {
    return adminJson({ error: "Founder Console is not available." }, { status: 403 });
  }

  const scopeParam = url.searchParams.get("scope");
  const scope = scopeParam === "view" ? "view" : scopeParam === "bundle" ? "bundle" : "raw";
  const name = url.searchParams.get("name") ?? url.searchParams.get("table") ?? "facts";
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";
  const launchReadiness = scope === "view" || scope === "bundle" ? await getLaunchReadinessReport() : undefined;
  const launchReadinessSnapshot = launchReadiness
    ? {
        configReadyForPrivateBeta: launchReadiness.configReadyForPrivateBeta,
        liveSmokeVerified: launchReadiness.liveSmokeVerified,
        readyForPublicLaunch: launchReadiness.readyForPublicLaunch
      }
    : undefined;

  if (scope === "bundle") {
    if (format !== "json") {
      return adminJson({ error: "Founder bundle export only supports format=json." }, { status: 400 });
    }
    const defaultLaunchReadiness = launchReadinessSnapshot ?? {
      configReadyForPrivateBeta: false,
      liveSmokeVerified: false,
      readyForPublicLaunch: false
    };
    if (name === "setup") {
      return adminJson({
        scope,
        name,
        exportedAt: new Date().toISOString(),
        bundle: await getFounderSetupBundle(defaultLaunchReadiness, launchReadiness?.checks ?? [])
      });
    }
    if (name === "integration") {
      return adminJson({
        scope,
        name,
        exportedAt: new Date().toISOString(),
        bundle: await getFounderIntegrationBundle(defaultLaunchReadiness, launchReadiness?.checks ?? [])
      });
    }
    if (name === "live-proof") {
      return adminJson({
        scope,
        name,
        exportedAt: new Date().toISOString(),
        bundle: await getFounderLiveProofBundle(defaultLaunchReadiness, launchReadiness?.checks ?? [])
      });
    }
    if (name !== "setup" && name !== "integration" && name !== "live-proof") {
      return adminJson({ error: "Unknown founder bundle." }, { status: 404 });
    }
  }

  const rows = await getFounderExportRows(scope === "raw" ? "raw" : "view", name, {
    launchReadiness: launchReadinessSnapshot
  });
  if (!rows) {
    return adminJson({ error: `Unknown founder ${scope}.` }, { status: 404 });
  }

  if (format === "json") {
    return adminJson({
      scope,
      name,
      exportedAt: new Date().toISOString(),
      rows
    });
  }

  return adminResponse(rowsToCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="family-financial-memory-${scope}-${name}.csv"`
    }
  });
}
