import { InviteAcceptance } from "@/components/invite-acceptance";

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams;
  return <InviteAcceptance inviteToken={params.token ?? ""} />;
}
