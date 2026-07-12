import { getDashboard } from "@/server/memory/engine";
import { getMemoryRepository, withMemoryRepositoryRetry } from "@/server/memory/store";
import { recordDashboardView } from "@/server/memory/usage";
import { resolveRequestAuthContext } from "@/server/auth/request-context";
import { noStoreJson } from "@/server/api/http";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const auth = await resolveRequestAuthContext(request, searchParams.get("householdId") ?? undefined, { access: "read" });
  if (!auth.ok) return auth.response;
  const householdId = auth.context.householdId;
  const month = searchParams.get("month") ?? undefined;
  const data = await withMemoryRepositoryRetry(householdId, async () => {
    const repository = getMemoryRepository(householdId);
    recordDashboardView(await repository.readAsync(), householdId);
    await repository.commitAsync();
    return getDashboard(householdId, month);
  });

  return noStoreJson({
    memory_object_id: null,
    confidence: 0.8,
    source_refs: [],
    current_state: "dashboard_view",
    needs_user_input: false,
    data
  });
}
