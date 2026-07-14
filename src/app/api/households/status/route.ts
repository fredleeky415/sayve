import { noStoreJson } from "@/server/api/http";
import { unexpectedApiErrorResponse } from "@/server/api/json";
import { resolveRequestAuthContext } from "@/server/auth/request-context";
import { createSupabaseServiceClient } from "@/server/supabase/service-client";

export async function GET(request: Request) {
  try {
    const auth = await resolveRequestAuthContext(request, new URL(request.url).searchParams.get("householdId") ?? undefined, { access: "read" });
    if (!auth.ok) return auth.response;

    const supabase = createSupabaseServiceClient();
    if (!supabase) {
      return noStoreJson(
        {
          configured: false,
          ok: false,
          error: "temporary_unavailable"
        },
        { status: 503 }
      );
    }

    const householdId = auth.context.householdId;
    const [household, members, invites] = await Promise.all([
      supabase.from("households").select("name").eq("id", householdId).maybeSingle(),
      supabase.from("household_members").select("user_id,role,created_at").eq("household_id", householdId).order("created_at", { ascending: true }),
      supabase.from("invites").select("email,role,expires_at,accepted_at,created_at").eq("household_id", householdId).order("created_at", { ascending: false }).limit(20)
    ]);

    if (household.error || members.error || invites.error) {
      return noStoreJson(
        {
          configured: true,
          ok: false,
          error: household.error?.message ?? members.error?.message ?? invites.error?.message ?? "temporary_unavailable"
        },
        { status: 500 }
      );
    }

    const memberRows = (members.data ?? []) as Array<{ user_id?: string | null; role?: string | null }>;
    const inviteRows = (invites.data ?? []) as Array<{
      email?: string | null;
      role?: string | null;
      expires_at?: string | null;
      accepted_at?: string | null;
      created_at?: string | null;
    }>;
    const now = Date.now();

    const pendingInvites = inviteRows
      .filter((invite) => {
        const accepted = Boolean(invite.accepted_at);
        const expired = !accepted && Boolean(invite.expires_at) && new Date(String(invite.expires_at)).getTime() < now;
        return !accepted && !expired;
      })
      .map((invite) => ({
        email: invite.email ?? "",
        role: invite.role ?? "member",
        expiresAt: invite.expires_at ?? ""
      }));

    const acceptedInvites = inviteRows.filter((invite) => Boolean(invite.accepted_at)).length;
    const expiredInvites = inviteRows.filter((invite) => !invite.accepted_at && invite.expires_at && new Date(invite.expires_at).getTime() < now).length;

    return noStoreJson({
      configured: true,
      ok: true,
      data: {
        householdId,
        householdName: household.data?.name ?? "Family Memory",
        role: auth.context.role ?? "member",
        memberCount: memberRows.length,
        ownerCount: memberRows.filter((member) => member.role === "owner").length,
        memberRoleCount: memberRows.filter((member) => member.role === "member").length,
        viewerCount: memberRows.filter((member) => member.role === "viewer").length,
        currentUserId: auth.context.userId ?? "",
        members: memberRows.map((member, index) => ({
          label: member.user_id === auth.context.userId ? "你" : `${member.role === "owner" ? "Owner" : member.role === "viewer" ? "Viewer" : "Member"} ${index + 1}`,
          role: member.role ?? "",
          isCurrentUser: member.user_id === auth.context.userId
        })),
        pendingInvites,
        pendingInviteCount: pendingInvites.length,
        acceptedInviteCount: acceptedInvites,
        expiredInviteCount: expiredInvites
      }
    });
  } catch (error) {
    console.error("[api/households/status] unexpected failure", error);
    return unexpectedApiErrorResponse(error);
  }
}
