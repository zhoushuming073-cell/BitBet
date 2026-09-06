import { NextResponse } from "next/server";
import { claimAll } from "@/lib/game/server";

export const dynamic = "force-dynamic";

export async function POST() {
  const amount = claimAll();
  return NextResponse.json({ claimed: amount });
}
