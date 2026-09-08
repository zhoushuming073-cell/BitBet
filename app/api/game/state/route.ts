import { NextResponse } from "next/server";
import { getAuthorityCompetition } from "@/lib/pulse5/server/ServerAuthority";
import { requireSiteUser, siteAuthError } from "@/lib/auth/sites-user";

export const dynamic = "force-dynamic";

type CompetitionState = Awaited<ReturnType<typeof getAuthorityCompetition>>;
const inFlightByUser = new Map<string, Promise<CompetitionState>>();

export async function GET(request: Request) {
  try {
    const identity = requireSiteUser(request);
    const localPreview = /^(127\.0\.0\.1|localhost)$/.test(new URL(request.url).hostname) ? 110_000 : undefined;
    let pending = inFlightByUser.get(identity.userId);
    if (!pending) {
      pending = getAuthorityCompetition(identity.userId, identity.displayName, undefined, localPreview);
      inFlightByUser.set(identity.userId, pending);
    }
    try {
      return NextResponse.json(await pending);
    } finally {
      if (inFlightByUser.get(identity.userId) === pending) inFlightByUser.delete(identity.userId);
    }
  } catch (error) {
    console.error("[game-state]", error instanceof Error ? error.message : "unknown error");
    return siteAuthError(error);
  }
}
