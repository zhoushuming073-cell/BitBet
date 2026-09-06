import { isCloudBaseConfigured } from "@/lib/cloudbase/config";
import { createCloudBaseRepositories } from "./cloudbase";
import { createMemoryRepositories } from "./memory";
import type { Repositories } from "./types";

let repos: Repositories | null = null;

/** Resolve the persistence backend (CloudBase when configured, memory otherwise). */
export function getRepositories(): Repositories {
  if (!repos) {
    repos = isCloudBaseConfigured() ? createCloudBaseRepositories() : createMemoryRepositories();
  }
  return repos;
}

/** Reset the cached backend (tests / env switch). */
export function resetRepositories(): void {
  repos = null;
}

export type { Repositories, LeaderboardSortKey, ClaimResult } from "./types";
