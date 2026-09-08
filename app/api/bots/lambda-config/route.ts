import { getAuthorityLambdaConfig, saveAuthorityLambdaConfig } from "@/lib/pulse5/server/ServerAuthority";
import { requireSiteUser, siteAuthError } from "@/lib/auth/sites-user";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = requireSiteUser(request);
    return Response.json({ config: await getAuthorityLambdaConfig(identity.userId) });
  } catch (error) {
    return siteAuthError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const identity = requireSiteUser(request);
    const config = await saveAuthorityLambdaConfig(identity.userId, await request.json());
    return Response.json({ config });
  } catch (error) {
    return siteAuthError(error);
  }
}
