import type { BotDisplayState } from "@/lib/pulse5/bots/BotDisplayState";
import type { LambdaConfig } from "@/lib/pulse5/bots/lambda/LambdaConfig";
import type { LedgerSnapshot, Side } from "@/lib/pulse5/engine/types";
import type { LambdaLearningReport } from "@/lib/pulse5/bots/lambda/LambdaLearning";

export interface AuthorityBotPayload {
  id: "alpha" | "beta" | "lambda";
  name: string;
  shortName: string;
  label: string;
  snapshot: LedgerSnapshot;
  lastAction: string;
  status: BotDisplayState;
  skippedRoundIds: number[];
}

export interface AuthorityCompetitionPayload {
  player: LedgerSnapshot;
  bots: AuthorityBotPayload[];
  lambdaConfig: LambdaConfig;
  lambdaLearning: {
    exp: number;
    level: number;
    generation: number;
    totalRounds: number;
    effectiveExperiences: number;
    calibrationBias: number;
    processedRoundIds: number[];
    recentReports: LambdaLearningReport[];
    stage: "初生期" | "适应期" | "成熟期";
    expInLevel: number;
    expToNextLevel: number;
  };
  serverTime: number;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw Object.assign(new Error(body.error || "服务暂时不可用"), { status: response.status });
  return body;
}

export async function fetchAuthorityState(signal?: AbortSignal) {
  return readJson<AuthorityCompetitionPayload>(await fetch("/api/game/state", { cache: "no-store", signal }));
}

export async function tickAuthorityState(signal?: AbortSignal) {
  return readJson<AuthorityCompetitionPayload>(await fetch("/api/game/tick", {
    method: "POST",
    cache: "no-store",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tickId: crypto.randomUUID() }),
  }));
}

export async function submitAuthorityOrder(side: Side, stake: number, idempotencyKey: string) {
  return readJson<{ snapshot: LedgerSnapshot }>(await fetch("/api/game/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ side, stake, idempotencyKey }),
  }));
}

export async function claimAuthority(orderId: string) {
  return readJson<{ snapshot: LedgerSnapshot }>(await fetch("/api/game/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId }),
  }));
}

export async function claimAuthorityAll() {
  return readJson<{ snapshot: LedgerSnapshot }>(await fetch("/api/game/claim-all", { method: "POST" }));
}

export async function saveLambdaConfig(config: LambdaConfig) {
  return readJson<{ config: LambdaConfig }>(await fetch("/api/bots/lambda-config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config),
  }));
}
