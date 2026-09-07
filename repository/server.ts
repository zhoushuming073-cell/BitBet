import { isMySqlConfigured } from "@/lib/mysql/pool";
import { createMemoryRepositories } from "./memory";
import { createMySqlRepositories } from "./mysql";
import type { Repositories } from "./types";

let repositories: Repositories | null = null;

/** Production is MySQL-only. Missing durable persistence is a startup error. */
export function getServerRepositories(): Repositories {
  if (repositories) return repositories;
  if (isMySqlConfigured()) {
    repositories = createMySqlRepositories();
    return repositories;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("生产环境必须配置 CloudBase MySQL；内存仓储已禁用");
  }
  repositories = createMemoryRepositories();
  return repositories;
}

export function resetServerRepositoriesForTests(): void {
  repositories = null;
}
