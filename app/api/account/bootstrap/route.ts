import { authErrorResponse, requireUser } from "@/lib/auth/require-user";
import { getServerRepositories } from "@/repository/server";
import { INITIAL_BALANCE } from "@/lib/domain/constants";

export const dynamic = "force-dynamic";

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.:+@-]{2,19}$/;

export async function POST(request: Request) {
  try {
    const identity = requireUser(request);
    const body = await request.json() as { username?: string };
    const username = body.username?.trim() ?? "";
    if (!USERNAME_RE.test(username)) {
      throw new Error("用户名需 3~20 位，以字母或数字开头，可含 -_.:+@");
    }
    const repos = getServerRepositories();
    const existing = await repos.users.getUserByAuthUid(identity.userId);
    if (existing) {
      await repos.users.touchLogin(identity.userId, Date.now());
      return Response.json({ account: { userId: existing.authUid, username: existing.username, isGuest: false } });
    }
    if (await repos.users.getUserByUsername(username)) throw new Error("用户名已被占用");
    const now = Date.now();
    await repos.users.createUser({ authUid: identity.userId, email: identity.email, username, now });
    await repos.profiles.createProfile({
      _id: identity.userId,
      userId: identity.userId,
      username,
      avatarUrl: "",
      bio: "",
      createdAt: now,
      updatedAt: now,
    });
    await repos.wallets.createWallet({ userId: identity.userId, initialBalance: INITIAL_BALANCE, now });
    return Response.json({ account: { userId: identity.userId, username, isGuest: false } }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
