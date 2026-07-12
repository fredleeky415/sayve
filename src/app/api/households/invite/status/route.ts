import { noStoreJson } from "@/server/api/http";
import { invitePreviewStatus } from "@/server/households/http";
import { getHouseholdInvitePreview } from "@/server/households/onboarding";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token") ?? "";
  const result = await getHouseholdInvitePreview(token);
  return noStoreJson(result, { status: invitePreviewStatus(result) });
}
