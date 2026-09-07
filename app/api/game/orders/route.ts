import { NextResponse } from "next/server";
import { placeOrder } from "@/lib/game/server";
import { authErrorResponse, requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      side?: string;
      stake?: number;
      midPrice?: number;
      idempotencyKey?: string;
    };
    const identity = requireUser(request);
    const side = body.side;
    const stake = Number(body.stake);
    const midPrice = Number(body.midPrice);
    const idempotencyKey = body.idempotencyKey?.trim() ?? "";

    if (side !== "up" && side !== "down") throw new Error("side 必须是 up 或 down");
    if (!(Number.isFinite(stake) && stake > 0)) throw new Error("stake 非法");
    if (!idempotencyKey || idempotencyKey.length > 128) throw new Error("idempotencyKey 非法");
    if (process.env.NODE_ENV === "production" && "midPrice" in body) {
      throw new Error("生产下单不接受客户端行情价格");
    }

    const result = await placeOrder(identity.userId, side, stake, idempotencyKey, midPrice);
    return NextResponse.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
