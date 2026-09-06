/**
 * Account service — registration, current-account resolution, sign-out.
 * Identity comes from CloudBase Auth (anonymous provider); a username is pure
 * business data (stored in users + profiles). No password is ever handled here.
 */
import { ensureAnonymousUid, getAuthAdapter } from "@/lib/cloudbase/auth";
import { getRepositories } from "@/repository";

export const INITIAL_BALANCE = 10_000;

const USERNAME_RE = /^[\w\u4e00-\u9fa5-]{3,20}$/;

export interface AccountUser {
  userId: string;
  username: string;
  isGuest: boolean;
}

function validateUsername(username: string): string {
  const name = username.trim();
  if (name.length < 3 || name.length > 20) throw new Error("用户名需 3~20 个字符");
  if (!USERNAME_RE.test(name)) throw new Error("用户名只能包含字母、数字、下划线、中文和连字符");
  return name;
}

/** Register a username for the current (anonymous) identity. Creates user + profile + wallet. */
export async function registerUser(username: string): Promise<AccountUser> {
  const name = validateUsername(username);
  const repos = getRepositories();

  const existing = await repos.users.getUserByUsername(name);
  if (existing) throw new Error("用户名已被占用");

  const uid = await ensureAnonymousUid();
  const now = Date.now();

  await repos.users.createUser({ authUid: uid, username: name, now });
  await repos.profiles.createProfile({
    _id: uid,
    userId: uid,
    username: name,
    avatarUrl: "",
    bio: "",
    createdAt: now,
    updatedAt: now,
  });
  await repos.wallets.createWallet({ userId: uid, initialBalance: INITIAL_BALANCE, now });

  return { userId: uid, username: name, isGuest: false };
}

/**
 * Resolve the current account. Returns null for a pure guest (anonymous uid but
 * no registered username). Guest play stays local-only and out of the leaderboard.
 */
export async function getCurrentAccount(): Promise<AccountUser | null> {
  const uid = await ensureAnonymousUid();
  const user = await getRepositories().users.getUserByAuthUid(uid);
  if (!user) return null;
  return { userId: uid, username: user.username, isGuest: false };
}

export async function getCurrentUid(): Promise<string> {
  return ensureAnonymousUid();
}

/** Sign in by username (the current anonymous identity must own it). */
export async function loginUser(username: string): Promise<AccountUser> {
  const name = username.trim();
  const uid = await ensureAnonymousUid();
  const user = await getRepositories().users.getUserByUsername(name);
  if (!user) throw new Error("该用户名未注册，请先注册");
  if (user.authUid !== uid) throw new Error("该用户名已在其他设备注册");
  await getRepositories().users.touchLogin(uid, Date.now());
  return { userId: uid, username: user.username, isGuest: false };
}

export async function logout(): Promise<void> {
  await getAuthAdapter().signOut();
}
