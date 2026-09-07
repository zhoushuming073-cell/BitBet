import { NextResponse } from "next/server";
import { settle } from "@/lib/game/server";
import { authErrorResponse, HttpAuthError, requireUser } from "@/lib/auth/require-user";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (process.env.NODE_ENV === "production") {
      const expected = process.env.INTERNAL_SETTLEMENT_SECRET;
      const supplied = request.headers.get("x-bitbet-internal-secret");
      if (!expected || supplied !== expected) throw new HttpAuthError("结算接口仅供可信内部任务调用", 403);
    }
    const identity = requireUser(request);
    const body = (await request.json()) as {
      roundId?: number;
      openPrice?: number;
      closePrice?: number;
    };
    const roundId = Number(body.roundId);
    const openPrice = Number(body.openPrice);
    const closePrice = Number(body.closePrice);

    if (!(Number.isFinite(roundId) && roundId > 0)) throw new Error("roundId 非法");
    if (!(Number.isFinite(openPrice) && openPrice > 0)) throw new Error("openPrice 非法");
    if (!(Number.isFinite(closePrice) && closePrice > 0)) throw new Error("closePrice 非法");

    const result = await settle(identity.userId, roundId, openPrice, closePrice);
    return NextResponse.json(result);
  } catch (error) {
    return authErrorResponse(error);
  }
}
