export type InviteLinks = {
  invitePath: string;
  inviteUrl: string;
  privateBetaInviteUrl?: string;
};

function configuredAppOrigin(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function originFromRequest(request: Request): string {
  const appOrigin = configuredAppOrigin();
  if (appOrigin) return appOrigin;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? request.headers.get("host")?.trim();
  if (forwardedHost) return `${forwardedProto || "https"}://${forwardedHost}`;
  return new URL(request.url).origin;
}

export function inviteLinksForRequest(request: Request, inviteToken: string): InviteLinks {
  const origin = originFromRequest(request);
  const invitePath = `/invite?token=${encodeURIComponent(inviteToken)}`;
  const inviteUrl = new URL(invitePath, origin).toString();
  const appAccessToken = process.env.APP_ACCESS_TOKEN?.trim();

  if (!appAccessToken) {
    return {
      invitePath,
      inviteUrl
    };
  }

  const privateBetaInviteUrl = new URL(inviteUrl);
  privateBetaInviteUrl.searchParams.set("access_token", appAccessToken);

  return {
    invitePath,
    inviteUrl,
    privateBetaInviteUrl: privateBetaInviteUrl.toString()
  };
}
