/**
 * Account service. Formal identity and passwords stay inside CloudBase Auth;
 * business data is accessed only through authenticated server APIs.
 */
import { ensureAnonymousUid, getAuthAdapter } from "@/lib/cloudbase/auth";
import { authenticatedFetch } from "@/lib/api/authenticated-fetch";
import { getRepositories } from "@/repository";
import { INITIAL_BALANCE } from "@/lib/domain/constants";

export { INITIAL_BALANCE };

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.:+@-]{2,19}$/;

export interface AccountUser {
  userId: string;
  username: string;
  email?: string;
  isGuest: boolean;
}

function validateUsername(username: string): string {
  const name = username.trim();
  if (name.length < 3 || name.length > 20) throw new Error("用户名需 3~20 个字符");
  if (!USERNAME_RE.test(name)) throw new Error("用户名需以字母或数字开头，可含 -_.:+@");
  return name;
}

/** Legacy memory-only registration retained solely for Node unit tests. */
export async function registerUser(username: string): Promise<AccountUser> {
  if (typeof window !== "undefined") {
    throw new Error("网页注册请使用邮箱、密码和验证码流程");
  }
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

export async function startEmailRegistration(input: {
  email: string;
  username: string;
  password: string;
}): Promise<void> {
  const name = validateUsername(input.username);
  await getAuthAdapter().startEmailRegistration({
    email: input.email.trim(),
    password: input.password,
    username: name,
  });
}

export async function completeEmailRegistration(code: string, username: string): Promise<AccountUser> {
  await getAuthAdapter().verifyEmailRegistration(code.trim());
  const result = await authenticatedFetch<{ account: AccountUser }>("/api/account/bootstrap", {
    method: "POST",
    body: JSON.stringify({ username: validateUsername(username) }),
  });
  return result.account;
}

/**
 * Resolve the current account. Returns null for a pure guest (anonymous uid but
 * no registered username). Guest play stays local-only and out of the leaderboard.
 */
export async function getCurrentAccount(): Promise<AccountUser | null> {
  if (typeof window === "undefined") {
    const uid = await ensureAnonymousUid();
    const user = await getRepositories().users.getUserByAuthUid(uid);
    return user ? { userId: uid, username: user.username, email: user.email, isGuest: false } : null;
  }
  const identity = await getAuthAdapter().getCurrentIdentity();
  if (!identity || identity.isAnonymous) return null;
  try {
    const result = await authenticatedFetch<{ account: AccountUser | null }>("/api/account/me");
    return result.account;
  } catch {
    return null;
  }
}

export async function getCurrentUid(): Promise<string> {
  return ensureAnonymousUid();
}

/** CloudBase email/password sign-in; no password is stored by BitBet. */
export async function loginUser(email: string, password: string): Promise<AccountUser> {
  await getAuthAdapter().signInWithPassword({ email: email.trim(), password });
  const result = await authenticatedFetch<{ account: AccountUser | null }>("/api/account/me");
  if (!result.account) throw new Error("账号资料未初始化，请重新完成注册");
  return result.account;
}

export async function logout(): Promise<void> {
  await getAuthAdapter().signOut();
}
