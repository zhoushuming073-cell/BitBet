import { NextResponse } from "next/server";
import { placeOrder } from "@/lib/game/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      side?: string;
      stake?: number;
      midPrice?: number;
      now?: number;
      idempotencyKey?: string;
    };
    const side = body.side;
    const stake = Number(body.stake);
    const midPrice = Number(body.midPrice);
    const now = Number.isFinite(body.now) ? (body.now as number) : Date.now();
    const idempotencyKey =
      body.idempotencyKey ??
      `${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

    if (side !== "up" && side !== "down") throw new Error("side 必须是 up 或 down");
    if (!(Number.isFinite(stake) && stake > 0)) throw new Error("stake 非法");
    if (!(Number.isFinite(midPrice) && midPrice > 0)) throw new Error("midPrice 非法");

    const order = placeOrder(side, stake, midPrice, now, idempotencyKey);
    return NextResponse.json({ order });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "下单失败" },
      { status: 400 },
    );
  }
}
