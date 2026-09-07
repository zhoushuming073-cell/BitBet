import { NextResponse } from "next/server";
import { getState } from "@/lib/game/server";
import { authErrorResponse, requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = requireUser(request);
    return NextResponse.json(await getState(identity.userId));
  } catch (error) {
    return authErrorResponse(error);
  }
}
