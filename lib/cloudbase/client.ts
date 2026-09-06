/**
 * Lazy CloudBase SDK access with a minimal typed surface. Returns null when the
 * env id is not configured, so the app (and the dev memory store) keeps working
 * with no secrets.
 */
import { getCloudBaseConfig } from "./config";

/** Minimal typed surface of the @cloudbase/js-sdk objects this app relies on. */
export interface CloudBaseApp {
  auth(): CloudBaseAuth;
  database(): CloudBaseDatabase;
}

export interface CloudBaseAuth {
  getLoginState(): Promise<{ user?: { uid?: string } } | null>;
  anonymousAuthProvider(): { signIn(): Promise<unknown> };
  signOut(): Promise<unknown>;
}

export interface CloudBaseDatabase {
  command: CloudBaseCommand;
  collection(name: string): CloudBaseCollection;
  runTransaction<T>(callback: (transaction: CloudBaseTransaction) => Promise<T>, times?: number): Promise<T>;
}

export interface CloudBaseTransaction {
  collection(name: string): CloudBaseCollection;
}

export interface CloudBaseCollection {
  doc(id: string): CloudBaseDoc;
  where(cond: Record<string, unknown>): CloudBaseCollection;
  orderBy(field: string, dir: "asc" | "desc"): CloudBaseCollection;
  limit(n: number): CloudBaseCollection;
  get(): Promise<{ data?: Record<string, unknown>[] }>;
  count(): Promise<{ total?: number }>;
}

export interface CloudBaseDoc {
  set(doc: Record<string, unknown>): Promise<unknown>;
  update(patch: Record<string, unknown>): Promise<unknown>;
  get(): Promise<{ data?: Record<string, unknown>[] }>;
}

export interface CloudBaseCommand {
  gt(value: number): unknown;
}

interface CloudBaseSdkModule {
  init(config: { env: string }): CloudBaseApp;
  default?: CloudBaseSdkModule;
}

let appPromise: Promise<CloudBaseApp> | null = null;

export async function getCloudBaseApp(): Promise<CloudBaseApp | null> {
  const config = getCloudBaseConfig();
  if (!config) return null;
  if (!appPromise) {
    appPromise = import("@cloudbase/js-sdk").then((mod) => {
      const sdk = mod as unknown as CloudBaseSdkModule;
      const cloudbase = sdk.default ?? sdk;
      return cloudbase.init({ env: config.envId });
    });
  }
  return appPromise;
}

/** Reset the cached app (mainly for tests / env switch). */
export function resetCloudBaseApp(): void {
  appPromise = null;
}
