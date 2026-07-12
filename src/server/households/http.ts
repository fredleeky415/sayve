import type { HouseholdOnboardingResult } from "@/server/households/onboarding";
import type { HouseholdInvitePreviewResult } from "@/server/households/onboarding";

export function inviteAcceptanceStatus(result: HouseholdOnboardingResult): number {
  if (result.ok || !result.configured) return 200;
  if (result.errorCode === "invite_not_found") return 404;
  if (result.errorCode === "invite_already_accepted") return 409;
  if (result.errorCode === "invite_expired") return 410;
  if (result.errorCode === "invite_invalid_role") return 400;
  if (result.errorCode === "invite_email_required") return 403;
  if (result.errorCode === "invite_email_mismatch") return 403;
  return 500;
}

export function invitePreviewStatus(result: HouseholdInvitePreviewResult): number {
  if (result.ok || !result.configured) return 200;
  if (result.status === "missing_token") return 400;
  if (result.status === "invite_not_found") return 404;
  if (result.status === "invite_already_accepted") return 409;
  if (result.status === "invite_expired") return 410;
  return 500;
}
