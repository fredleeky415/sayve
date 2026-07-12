import { noStoreJson } from "@/server/api/http";
import { readJsonObject } from "@/server/api/json";
import { resolveSupabaseBearerUser } from "@/server/auth/request-context";
import { createFounderHousehold } from "@/server/households/onboarding";
import { createSupabaseServiceClient } from "@/server/supabase/service-client";

export async function POST(request: Request) {
  const user = await resolveSupabaseBearerUser(request);
  if (!user?.id) {
    return noStoreJson({ ok: false, error: "login_required" }, { status: 401 });
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return noStoreJson({ ok: false, error: "temporary_unavailable" }, { status: 503 });
  }

  const existing = await supabase
    .from("household_members")
    .select("household_id, role, households(id, name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (existing.error) {
    return noStoreJson({ ok: false, error: existing.error.message }, { status: 500 });
  }

  const rows = existing.data ?? [];
  if (rows.length > 0) {
    const first = rows[0];
    const household = Array.isArray(first.households) ? first.households[0] : first.households;
    return noStoreJson({
      ok: true,
      household: {
        id: first.household_id,
        name: household?.name ?? "Household",
        role: first.role
      },
      created: false
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await readJsonObject(request);
  } catch {
    body = {};
  }

  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Family Memory";
  const defaultCurrency = typeof body.defaultCurrency === "string" && body.defaultCurrency.trim() ? body.defaultCurrency.trim() : "HKD";
  const locale = typeof body.locale === "string" && body.locale.trim() ? body.locale.trim() : "zh-Hant-HK";

  const created = await createFounderHousehold({
    name,
    ownerUserId: user.id,
    defaultCurrency,
    locale
  });

  if (!created.configured) {
    return noStoreJson({ ok: false, error: created.error }, { status: 503 });
  }

  if (!created.ok) {
    return noStoreJson({ ok: false, error: created.error ?? "Could not create household." }, { status: 500 });
  }

  const household = created.data?.household as { id?: string; name?: string } | undefined;
  return noStoreJson({
    ok: true,
    household: {
      id: household?.id ?? "",
      name: household?.name ?? name,
      role: "owner"
    },
    created: true
  });
}
