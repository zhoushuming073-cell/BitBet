import type { BotPastResult } from "./BotStrategy";

export type BotDisplayState = "HOT" | "NORMAL" | "CAUTIOUS" | "WAITING" | "COOLDOWN" | "SCANNING" | "EDGE" | "DEFENSIVE";

export function deriveBotDisplayState(
  id: "alpha" | "beta" | "lambda",
  recentResults: BotPastResult[],
  lastAction: string,
  coolingDown: boolean,
): BotDisplayState {
  let wins = 0;
  let losses = 0;
  for (const result of recentResults) {
    if (result.profit > 0 && losses === 0) wins += 1;
    else if (result.profit < 0 && wins === 0) losses += 1;
    else break;
  }

  if (id === "alpha") {
    if (wins >= 2) return "HOT";
    if (losses >= 2 || lastAction.includes("等待成交条件")) return "CAUTIOUS";
    return "NORMAL";
  }

  if (id === "lambda") {
    if (lastAction.includes("Adaptive hedge")) return "DEFENSIVE";
    if (/positive edge|momentum|slope|Breakout|Mean deviation/.test(lastAction)) return "EDGE";
    return "SCANNING";
  }

  if (coolingDown || lastAction.includes("休息")) return "COOLDOWN";
  if (/等待|观察|不足|观望|尚未|已过|不提前/.test(lastAction)) return "WAITING";
  return "NORMAL";
}
