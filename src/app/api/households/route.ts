import { isSupabaseAuthRequired, resolveRequestUserId, resolveSupabaseBearerUserId } from "@/server/auth/request-context";
import { noStoreJson } from "@/server/api/http";
import { createSupabaseServiceClient } from "@/server/supabase/service-client";

export async function GET(request: Request) {
  const userId = isSupabaseAuthRequired() ? await resolveSupabaseBearerUserId(request) : await resolveRequestUserId(request);
  const prototypeHouseholdId = request.headers.get("x-household-id") ?? process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID;

  if (!userId) {
    return noStoreJson({ configured: true, ok: false, error: "login_required", households: [] }, { status: 401 });
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    if (isSupabaseAuthRequired()) {
      return noStoreJson(
        {
          configured: false,
          ok: false,
          error: "temporary_unavailable",
          households: []
        },
        { status: 503 }
      );
    }

    return noStoreJson({
      configured: false,
      ok: true,
      households: [
        {
          id: prototypeHouseholdId ?? "household_demo",
          name: "Prototype Household",
          role: "owner"
        }
      ]
    });
  }

  const { data, error } = await supabase
    .from("household_members")
    .select("household_id, role, households(id, name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    return noStoreJson({ configured: true, ok: false, error: error.message, households: [] }, { status: 500 });
  }

  const households = (data ?? []).map((row) => {
    const household = Array.isArray(row.households) ? row.households[0] : row.households;
    return {
      id: row.household_id,
      name: household?.name ?? "Household",
      role: row.role
    };
  });

  return noStoreJson({ configured: true, ok: true, households });
}
