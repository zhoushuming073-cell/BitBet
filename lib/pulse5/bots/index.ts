import { BotAlphaStrategy } from "./BotAlphaStrategy";
import { BotBetaStrategy } from "./BotBetaStrategy";

export const BOT_DEFINITIONS = [
  {
    id: "alpha" as const,
    name: "Bot Alpha",
    shortName: "A",
    strategy: new BotAlphaStrategy(),
    storageKey: "pulse5-v2-bot-alpha-v1",
  },
  {
    id: "beta" as const,
    name: "Bot Beta",
    shortName: "B",
    strategy: new BotBetaStrategy(),
    storageKey: "pulse5-v2-bot-beta-v1",
  },
] as const;

export { currentWeekStart } from "./week";
export type { BotDecision, BotDecisionContext, BotPastResult, BotStrategy } from "./BotStrategy";
