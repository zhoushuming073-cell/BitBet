import { NextResponse } from "next/server";
import { placeAuthorityOrder } from "@/lib/pulse5/server/ServerAuthority";
import { requireSiteUser, siteAuthError } from "@/lib/auth/sites-user";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      side?: string;
      stake?: number;
      idempotencyKey?: string;
    };
    const identity = requireSiteUser(request);
    const side = body.side;
    const stake = Number(body.stake);
    const idempotencyKey = body.idempotencyKey?.trim() ?? "";

    if (side !== "up" && side !== "down") throw new Error("side 必须是 up 或 down");
    if (!(Number.isFinite(stake) && stake > 0)) throw new Error("stake 非法");
    if (!idempotencyKey || idempotencyKey.length > 128) throw new Error("idempotencyKey 非法");
    const localPreview = /^(127\.0\.0\.1|localhost)$/.test(new URL(request.url).hostname) ? 110_000 : undefined;
    const result = await placeAuthorityOrder(identity.userId, identity.displayName, side, stake, idempotencyKey, undefined, localPreview);
    return NextResponse.json(result);
  } catch (error) {
    return siteAuthError(error);
  }
}
