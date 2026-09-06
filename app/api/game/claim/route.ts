import { NextResponse } from "next/server";
import { claimOrder } from "@/lib/game/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { orderId?: string };
    if (!body.orderId) throw new Error("orderId 缺失");
    const amount = claimOrder(body.orderId);
    return NextResponse.json({ claimed: amount });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "领取失败" },
      { status: 400 },
    );
  }
}
