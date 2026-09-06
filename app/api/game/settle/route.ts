import { NextResponse } from "next/server";
import { settle } from "@/lib/game/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      roundId?: number;
      openPrice?: number;
      closePrice?: number;
      now?: number;
    };
    const roundId = Number(body.roundId);
    const openPrice = Number(body.openPrice);
    const closePrice = Number(body.closePrice);
    const now = Number.isFinite(body.now) ? (body.now as number) : Date.now();

    if (!(Number.isFinite(roundId) && roundId > 0)) throw new Error("roundId 非法");
    if (!(Number.isFinite(openPrice) && openPrice > 0)) throw new Error("openPrice 非法");
    if (!(Number.isFinite(closePrice) && closePrice > 0)) throw new Error("closePrice 非法");

    const result = settle(roundId, openPrice, closePrice, now);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "结算失败" },
      { status: 400 },
    );
  }
}
