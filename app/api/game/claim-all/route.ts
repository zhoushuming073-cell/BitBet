import { NextResponse } from "next/server";
import { claimAuthorityAll } from "@/lib/pulse5/server/ServerAuthority";
import { requireSiteUser, siteAuthError } from "@/lib/auth/sites-user";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const identity = requireSiteUser(request);
    const snapshot = await claimAuthorityAll(identity.userId);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return siteAuthError(error);
  }
}
