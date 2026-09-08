import { NextResponse } from "next/server";
import { getAuthorityCompetition } from "@/lib/pulse5/server/ServerAuthority";
import { requireSiteUser, siteAuthError } from "@/lib/auth/sites-user";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = requireSiteUser(request);
    const localPreview = /^(127\.0\.0\.1|localhost)$/.test(new URL(request.url).hostname) ? 110_000 : undefined;
    return NextResponse.json(await getAuthorityCompetition(identity.userId, identity.displayName, undefined, localPreview));
  } catch (error) {
    return siteAuthError(error);
  }
}
