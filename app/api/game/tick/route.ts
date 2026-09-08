import { NextResponse } from "next/server";
import { tickAuthorityCompetition } from "@/lib/pulse5/server/ServerAuthority";
import { requireSiteUser, siteAuthError } from "@/lib/auth/sites-user";

export const dynamic = "force-dynamic";

type CompetitionState = Awaited<ReturnType<typeof tickAuthorityCompetition>>;
const inFlightByUser = new Map<string, Promise<CompetitionState>>();
const completedTicks = new Map<string, { at: number; value: CompetitionState }>();

export async function POST(request: Request) {
  try {
    const identity = requireSiteUser(request);
    const body = await request.json().catch(() => ({})) as { tickId?: unknown };
    if (typeof body.tickId !== "string" || body.tickId.length < 8 || body.tickId.length > 100) {
      return NextResponse.json({ error: "tickId 无效" }, { status: 400 });
    }
    const tickKey = `${identity.userId}:${body.tickId}`;
    const completed = completedTicks.get(tickKey);
    if (completed && Date.now() - completed.at <= 60_000) return NextResponse.json(completed.value);
    const localPreview = /^(127\.0\.0\.1|localhost)$/.test(new URL(request.url).hostname) ? 110_000 : undefined;
    let pending = inFlightByUser.get(identity.userId);
    if (!pending) {
      pending = tickAuthorityCompetition(identity.userId, identity.displayName, undefined, localPreview);
      inFlightByUser.set(identity.userId, pending);
    }
    try {
      const value = await pending;
      completedTicks.set(tickKey, { at: Date.now(), value });
      if (completedTicks.size > 256) {
        const oldest = [...completedTicks.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 64);
        for (const [key] of oldest) completedTicks.delete(key);
      }
      return NextResponse.json(value);
    } finally {
      if (inFlightByUser.get(identity.userId) === pending) inFlightByUser.delete(identity.userId);
    }
  } catch (error) {
    console.error("[game-tick]", error instanceof Error ? error.message : "unknown error");
    return siteAuthError(error);
  }
}
