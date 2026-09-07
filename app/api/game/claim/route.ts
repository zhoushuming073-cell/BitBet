import { NextResponse } from "next/server";
import { claimOrder } from "@/lib/game/server";
import { authErrorResponse, requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const identity = requireUser(request);
    const body = (await request.json()) as { orderId?: string };
    if (!body.orderId) throw new Error("orderId 缺失");
    const amount = await claimOrder(identity.userId, body.orderId);
    return NextResponse.json({ claimed: amount });
  } catch (error) {
    return authErrorResponse(error);
  }
}
