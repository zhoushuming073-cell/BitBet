import { NextResponse } from "next/server";
import { claimAuthorityOrder } from "@/lib/pulse5/server/ServerAuthority";
import { requireSiteUser, siteAuthError } from "@/lib/auth/sites-user";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const identity = requireSiteUser(request);
    const body = (await request.json()) as { orderId?: string };
    if (!body.orderId) throw new Error("orderId 缺失");
    const snapshot = await claimAuthorityOrder(identity.userId, body.orderId);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return siteAuthError(error);
  }
}
