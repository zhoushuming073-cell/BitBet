/**
 * Auth adapter — decouples identity from business logic. CloudBase's official
 * email/password flow is used for formal accounts and credentials are never
 * persisted by this application. A localStorage anonymous identity keeps guest
 * play available when CloudBase is not configured during development.
 */
import { isCloudBaseConfigured } from "./config";
import { getCloudBaseApp, type CloudBaseApp, type CloudBaseAuthResult } from "./client";

export interface AuthIdentity {
  uid: string;
  email?: string;
  username?: string;
  isAnonymous: boolean;
}

export interface AuthAdapter {
  /** Current signed-in uid, or null when signed out. */
  getCurrentUid(): Promise<string | null>;
  getCurrentIdentity(): Promise<AuthIdentity | null>;
  getAccessToken(): Promise<string | null>;
  /** Anonymous sign-in (guest identity), returns the uid. */
  signInAnonymous(): Promise<string>;
  startEmailRegistration(input: { email: string; password: string; username: string }): Promise<void>;
  verifyEmailRegistration(code: string): Promise<AuthIdentity>;
  signInWithPassword(input: { email: string; password: string }): Promise<AuthIdentity>;
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

  async getCurrentIdentity(): Promise<AuthIdentity | null> {
    const uid = await this.getCurrentUid();
    return uid ? { uid, isAnonymous: true } : null;
  }

  getAccessToken(): Promise<string | null> {
    return Promise.resolve(null);
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

  async startEmailRegistration(): Promise<void> {
    throw new Error("正式账号暂不可用，请稍后再试");
  }

  async verifyEmailRegistration(): Promise<AuthIdentity> {
    throw new Error("正式账号暂不可用，请稍后再试");
  }

  async signInWithPassword(): Promise<AuthIdentity> {
    throw new Error("正式账号暂不可用，请稍后再试");
  }

  async signOut(): Promise<void> {
    try {
      localStorage.removeItem(MOCK_UID_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** CloudBase official Auth. Lazily imports the SDK. */
export class CloudBaseAuthAdapter implements AuthAdapter {
  private verifyRegistration: ((input: { token: string }) => Promise<CloudBaseAuthResult>) | null = null;
  private getApp(): Promise<CloudBaseApp> {
    return getCloudBaseApp().then((app) => {
      if (!app) throw new Error("CloudBase not configured");
      return app;
    });
  }

  async getCurrentUid(): Promise<string | null> {
    return (await this.getCurrentIdentity())?.uid ?? null;
  }

  async getCurrentIdentity(): Promise<AuthIdentity | null> {
    try {
      const app = await this.getApp();
      const state = await app.auth().getLoginState();
      const user = state?.user;
      const uid = user?.id ?? user?.uid;
      if (!uid || !user) return null;
      return {
        uid,
        email: user.email ?? undefined,
        username: user.user_metadata?.username ?? user.user_metadata?.name,
        isAnonymous: Boolean(user.is_anonymous),
      };
    } catch {
      return null;
    }
  }

  async getAccessToken(): Promise<string | null> {
    try {
      const app = await this.getApp();
      const result = await app.auth().getAccessToken();
      return result.accessToken || null;
    } catch {
      return null;
    }
  }

  async signInAnonymous(): Promise<string> {
    const app = await this.getApp();
    const auth = app.auth();
    const result = await auth.signInAnonymously();
    if (result.error) throw new Error(result.error.message || "匿名登录失败");
    const state = await auth.getLoginState();
    const uid = state?.user?.uid;
    if (!uid) throw new Error("anonymous sign-in returned no uid");
    return uid;
  }

  async startEmailRegistration(input: { email: string; password: string; username: string }): Promise<void> {
    const app = await this.getApp();
    const result = await app.auth().signUp({ ...input, name: input.username });
    if (result.error) throw new Error(result.error.message || "发送验证码失败");
    if (!result.data.verifyOtp) throw new Error("CloudBase 未返回邮箱验证码校验流程");
    this.verifyRegistration = result.data.verifyOtp;
  }

  async verifyEmailRegistration(code: string): Promise<AuthIdentity> {
    if (!this.verifyRegistration) throw new Error("请先发送邮箱验证码");
    const result = await this.verifyRegistration({ token: code });
    if (result.error) throw new Error(result.error.message || "验证码错误");
    this.verifyRegistration = null;
    const identity = await this.getCurrentIdentity();
    if (!identity || identity.isAnonymous) throw new Error("注册后未取得正式登录态");
    return identity;
  }

  async signInWithPassword(input: { email: string; password: string }): Promise<AuthIdentity> {
    const app = await this.getApp();
    const result = await app.auth().signInWithPassword(input);
    if (result.error) throw new Error(result.error.message || "邮箱或密码错误");
    const identity = await this.getCurrentIdentity();
    if (!identity || identity.isAnonymous) throw new Error("未取得正式登录态");
    return identity;
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
