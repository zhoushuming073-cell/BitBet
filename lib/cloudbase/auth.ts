/**
 * Auth adapter — decouples identity from business logic. CloudBase official
 * Auth is used in production (anonymous provider out of the box, no password
 * stored); a localStorage mock keeps the app runnable without any CloudBase
 * config in development.
 */
import { isCloudBaseConfigured } from "./config";
import { getCloudBaseApp, type CloudBaseApp } from "./client";

export interface AuthAdapter {
  /** Current signed-in uid, or null when signed out. */
  getCurrentUid(): Promise<string | null>;
  /** Anonymous sign-in (guest identity), returns the uid. */
  signInAnonymous(): Promise<string>;
  /** Clear the session. */
  signOut(): Promise<void>;
}

const MOCK_UID_KEY = "bitbet:mock:auth-uid";

/** Development fallback: a stable random uid kept in localStorage. */
export class MockAuthAdapter implements AuthAdapter {
  getCurrentUid(): Promise<string | null> {
    try {
      return Promise.resolve(localStorage.getItem(MOCK_UID_KEY));
    } catch {
      return Promise.resolve(null);
    }
  }

  async signInAnonymous(): Promise<string> {
    const uid = `mock-${Math.random().toString(36).slice(2, 12)}`;
    try {
      localStorage.setItem(MOCK_UID_KEY, uid);
    } catch {
      /* ignore — still return an in-memory identity */
    }
    return uid;
  }

  async signOut(): Promise<void> {
    try {
      localStorage.removeItem(MOCK_UID_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** CloudBase official Auth (anonymous provider). Lazily imports the SDK. */
export class CloudBaseAuthAdapter implements AuthAdapter {
  private getApp(): Promise<CloudBaseApp> {
    return getCloudBaseApp().then((app) => {
      if (!app) throw new Error("CloudBase not configured");
      return app;
    });
  }

  async getCurrentUid(): Promise<string | null> {
    try {
      const app = await this.getApp();
      const state = await app.auth().getLoginState();
      return state?.user?.uid ?? null;
    } catch {
      return null;
    }
  }

  async signInAnonymous(): Promise<string> {
    const app = await this.getApp();
    const auth = app.auth();
    await auth.anonymousAuthProvider().signIn();
    const state = await auth.getLoginState();
    const uid = state?.user?.uid;
    if (!uid) throw new Error("anonymous sign-in returned no uid");
    return uid;
  }

  async signOut(): Promise<void> {
    try {
      const app = await this.getApp();
      await app.auth().signOut();
    } catch {
      /* ignore */
    }
  }
}

let adapter: AuthAdapter | null = null;

export function getAuthAdapter(): AuthAdapter {
  if (!adapter) {
    adapter = isCloudBaseConfigured() ? new CloudBaseAuthAdapter() : new MockAuthAdapter();
  }
  return adapter;
}

/** Ensure an anonymous identity exists; returns the uid (creates one if needed). */
export async function ensureAnonymousUid(): Promise<string> {
  const auth = getAuthAdapter();
  const existing = await auth.getCurrentUid();
  if (existing) return existing;
  return auth.signInAnonymous();
}
