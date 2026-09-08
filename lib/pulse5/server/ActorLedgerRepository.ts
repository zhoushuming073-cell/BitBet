import type { LedgerSnapshot } from "../engine/types";
import { emptySnapshot } from "../orders/LedgerStore";
import { DEFAULT_LAMBDA_CONFIG, sanitizeLambdaConfig, type LambdaConfig } from "../bots/lambda/LambdaConfig";
import { defaultLambdaLearningState, type LambdaLearningState } from "../bots/lambda/LambdaLearning";

export type ActorType = "player" | "alpha" | "beta" | "lambda";

export interface BotRuntimeState {
  lastAction: string;
  lastEvaluatedAt: number;
  observedRoundId: number | null;
  skippedRoundIds: number[];
  orderSequence: number;
}

export interface ActorLedgerRecord {
  actorId: string;
  ownerUserId: string;
  actorType: ActorType;
  displayName: string;
  snapshot: LedgerSnapshot;
  runtime: BotRuntimeState;
  version: number;
}

interface D1RunResult { meta?: { changes?: number }; changes?: number }
interface D1Prepared {
  bind(...values: unknown[]): D1Prepared;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<D1RunResult>;
}
export interface D1Like { prepare(query: string): D1Prepared }

const memoryActors = new Map<string, ActorLedgerRecord>();
const memoryConfigs = new Map<string, LambdaConfig>();
const memoryLeases = new Map<string, number>();
const memoryLearning = new Map<string, StoredLambdaLearningState>();

export interface StoredLambdaLearningState extends LambdaLearningState { version: number }

export function defaultBotRuntime(): BotRuntimeState {
  return { lastAction: "观察中", lastEvaluatedAt: 0, observedRoundId: null, skippedRoundIds: [], orderSequence: 0 };
}

function isMissingLearningTable(error: unknown) {
  return error instanceof Error && /no such table:\s*lambda_learning_states/i.test(error.message);
}

export class ActorLedgerRepository {
  constructor(private readonly db: D1Like | null) {}

  async load(actorId: string, ownerUserId: string, actorType: ActorType, displayName: string): Promise<ActorLedgerRecord> {
    if (!this.db) {
      const existing = memoryActors.get(actorId);
      if (existing) return structuredClone(existing);
      const created = { actorId, ownerUserId, actorType, displayName, snapshot: emptySnapshot(), runtime: defaultBotRuntime(), version: 1 };
      memoryActors.set(actorId, structuredClone(created));
      return created;
    }
    const initialSnapshot = JSON.stringify(emptySnapshot());
    const initialRuntime = JSON.stringify(defaultBotRuntime());
    await this.db.prepare(
      `INSERT OR IGNORE INTO game_actor_ledgers
       (actor_id, owner_user_id, actor_type, display_name, snapshot_json, runtime_json, version, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    ).bind(actorId, ownerUserId, actorType, displayName, initialSnapshot, initialRuntime, Date.now()).run();
    const row = await this.db.prepare(
      `SELECT actor_id, owner_user_id, actor_type, display_name, snapshot_json, runtime_json, version
       FROM game_actor_ledgers WHERE actor_id = ?`,
    ).bind(actorId).first<Record<string, unknown>>();
    if (!row) throw new Error("权威账本初始化失败");
    return {
      actorId: String(row.actor_id),
      ownerUserId: String(row.owner_user_id),
      actorType: String(row.actor_type) as ActorType,
      displayName: String(row.display_name),
      snapshot: JSON.parse(String(row.snapshot_json)) as LedgerSnapshot,
      runtime: { ...defaultBotRuntime(), ...JSON.parse(String(row.runtime_json || "{}")) as Partial<BotRuntimeState> },
      version: Number(row.version),
    };
  }

  async save(record: ActorLedgerRecord): Promise<boolean> {
    if (!this.db) {
      const current = memoryActors.get(record.actorId);
      if (current && current.version !== record.version) return false;
      memoryActors.set(record.actorId, structuredClone({ ...record, version: record.version + 1 }));
      record.version += 1;
      return true;
    }
    const result = await this.db.prepare(
      `UPDATE game_actor_ledgers SET snapshot_json = ?, runtime_json = ?, display_name = ?,
       version = version + 1, updated_at = ? WHERE actor_id = ? AND version = ?`,
    ).bind(JSON.stringify(record.snapshot), JSON.stringify(record.runtime), record.displayName, Date.now(), record.actorId, record.version).run();
    const changed = result.meta?.changes ?? result.changes ?? 0;
    if (changed > 0) record.version += 1;
    return changed > 0;
  }

  async listOwners(): Promise<string[]> {
    if (!this.db) return [...new Set([...memoryActors.values()].map((row) => row.ownerUserId))];
    const result = await this.db.prepare("SELECT DISTINCT owner_user_id FROM game_actor_ledgers").all<{ owner_user_id: string }>();
    return (result.results ?? []).map((row) => row.owner_user_id);
  }

  async getLambdaConfig(userId: string): Promise<LambdaConfig> {
    if (!this.db) return structuredClone(memoryConfigs.get(userId) ?? DEFAULT_LAMBDA_CONFIG);
    const row = await this.db.prepare("SELECT config_json FROM lambda_configs WHERE user_id = ?").bind(userId).first<{ config_json: string }>();
    return row ? sanitizeLambdaConfig(JSON.parse(row.config_json)) : structuredClone(DEFAULT_LAMBDA_CONFIG);
  }

  async saveLambdaConfig(userId: string, input: unknown): Promise<LambdaConfig> {
    const config = sanitizeLambdaConfig(input);
    if (!this.db) {
      memoryConfigs.set(userId, structuredClone(config));
      const learning = memoryLearning.get(userId);
      if (learning) memoryLearning.set(userId, { ...learning, config: structuredClone(config), version: learning.version + 1 });
      return config;
    }
    await this.db.prepare(
      `INSERT INTO lambda_configs (user_id, config_json, version, updated_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id) DO UPDATE SET config_json = excluded.config_json,
       version = lambda_configs.version + 1, updated_at = excluded.updated_at`,
    ).bind(userId, JSON.stringify(config), Date.now()).run();
    const learning = await this.getLambdaLearningState(userId, config);
    if (learning.version > 0) {
      learning.config = config;
      await this.saveLambdaLearningState(userId, learning);
    }
    return config;
  }

  async getLambdaLearningState(userId: string, baseConfig?: LambdaConfig): Promise<StoredLambdaLearningState> {
    const config = baseConfig ?? await this.getLambdaConfig(userId);
    if (!this.db) {
      return structuredClone(memoryLearning.get(userId) ?? { ...defaultLambdaLearningState(config), version: 0 });
    }
    let row: { state_json: string; version: number } | null;
    try {
      row = await this.db.prepare("SELECT state_json, version FROM lambda_learning_states WHERE user_id = ?")
        .bind(userId).first<{ state_json: string; version: number }>();
    } catch (error) {
      if (isMissingLearningTable(error)) return { ...defaultLambdaLearningState(config), version: 0 };
      throw error;
    }
    if (!row) return { ...defaultLambdaLearningState(config), version: 0 };
    const stored = JSON.parse(row.state_json) as Partial<LambdaLearningState>;
    return {
      ...defaultLambdaLearningState(config),
      ...stored,
      config: sanitizeLambdaConfig(stored.config ?? config),
      processedRoundIds: Array.isArray(stored.processedRoundIds) ? stored.processedRoundIds.slice(-500) : [],
      recentReports: Array.isArray(stored.recentReports) ? stored.recentReports.slice(0, 12) : [],
      version: Number(row.version),
    };
  }

  async saveLambdaLearningState(userId: string, state: StoredLambdaLearningState): Promise<boolean> {
    const { version, ...payload } = state;
    if (!this.db) {
      const current = memoryLearning.get(userId);
      if (current && current.version !== version) return false;
      memoryLearning.set(userId, structuredClone({ ...state, version: version + 1 }));
      state.version += 1;
      return true;
    }
    try {
      if (version === 0) {
        const result = await this.db.prepare(
          "INSERT OR IGNORE INTO lambda_learning_states (user_id, state_json, version, updated_at) VALUES (?, ?, 1, ?)",
        ).bind(userId, JSON.stringify(payload), Date.now()).run();
        const changed = result.meta?.changes ?? result.changes ?? 0;
        if (changed > 0) state.version = 1;
        return changed > 0;
      }
      const result = await this.db.prepare(
        "UPDATE lambda_learning_states SET state_json = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?",
      ).bind(JSON.stringify(payload), Date.now(), userId, version).run();
      const changed = result.meta?.changes ?? result.changes ?? 0;
      if (changed > 0) state.version += 1;
      return changed > 0;
    } catch (error) {
      if (isMissingLearningTable(error)) return false;
      throw error;
    }
  }

  async acquireLease(key: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    if (!this.db) {
      if ((memoryLeases.get(key) ?? 0) >= now) return false;
      memoryLeases.set(key, now + ttlMs);
      return true;
    }
    const owner = crypto.randomUUID();
    const result = await this.db.prepare(
      `INSERT INTO bot_scheduler_leases (lease_key, lease_until, owner, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(lease_key) DO UPDATE SET lease_until = excluded.lease_until, owner = excluded.owner,
       updated_at = excluded.updated_at WHERE bot_scheduler_leases.lease_until < ?`,
    ).bind(key, now + ttlMs, owner, now, now).run();
    return (result.meta?.changes ?? result.changes ?? 0) > 0;
  }
}
