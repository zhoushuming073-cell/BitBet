import { authErrorResponse, requireUser } from "@/lib/auth/require-user";
import { getServerRepositories } from "@/repository/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = requireUser(request);
    const repos = getServerRepositories();
    const user = await repos.users.getUserByAuthUid(identity.userId);
    if (!user) return Response.json({ account: null });
    return Response.json({
      account: { userId: user.authUid, username: user.username, email: user.email, isGuest: false },
      wallet: await repos.wallets.getWallet(identity.userId),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
