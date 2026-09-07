import { NextResponse } from "next/server";
import { claimAll } from "@/lib/game/server";
import { authErrorResponse, requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const identity = requireUser(request);
    const amount = await claimAll(identity.userId);
    return NextResponse.json({ claimed: amount });
  } catch (error) {
    return authErrorResponse(error);
  }
}
