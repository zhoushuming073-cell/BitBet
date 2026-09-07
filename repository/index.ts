import { createCloudBaseRepositories } from "./cloudbase";
import { createMemoryRepositories } from "./memory";
import type { Repositories } from "./types";

let repos: Repositories | null = null;

/**
 * Browser/dev repository resolver. Formal accounts must use authenticated server
 * APIs backed by MySQL; the old NoSQL adapter is opt-in for migration tooling only.
 */
export function getRepositories(): Repositories {
  if (!repos) {
    const legacyNoSql = process.env.NODE_ENV !== "production"
      && process.env.NEXT_PUBLIC_ENABLE_LEGACY_NOSQL_DEV === "true";
    if (process.env.NODE_ENV === "production") {
      throw new Error("生产环境禁止旧版浏览器/内存仓储；请使用已鉴权的服务端 MySQL 接口");
    }
    repos = legacyNoSql ? createCloudBaseRepositories() : createMemoryRepositories();
  }
  return repos;
}

/** Reset the cached backend (tests / env switch). */
export function resetRepositories(): void {
  repos = null;
}

export type { Repositories, LeaderboardSortKey, ClaimResult } from "./types";
