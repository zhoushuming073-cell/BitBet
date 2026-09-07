export class HttpAuthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface AuthenticatedUser {
  userId: string;
  email?: string;
  username?: string;
}

interface TokenClaims {
  exp?: number;
  project_id?: string;
  user_id?: string;
  sub?: string;
  email?: string;
  name?: string;
}

function decodeBase64Url(segment: string): string {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeGatewayVerifiedToken(token: string): TokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpAuthError("无效登录凭证", 401);
  try {
    const header = JSON.parse(decodeBase64Url(parts[0])) as { alg?: string };
    if (!header.alg || header.alg.toLowerCase() === "none") throw new Error("unsafe jwt algorithm");
    return JSON.parse(decodeBase64Url(parts[1])) as TokenClaims;
  } catch {
    throw new HttpAuthError("无效登录凭证", 401);
  }
}

/**
 * Trust boundary: production accepts identity only after CloudBase HTTP Gateway
 * has validated the bearer token. Directly exposed deployments fail closed.
 */
export function requireUser(request: Request): AuthenticatedUser {
  if (process.env.NODE_ENV !== "production") {
    const devUser = request.headers.get("x-bitbet-dev-user-id")?.trim();
    if (devUser) return { userId: devUser };
  }

  if (process.env.CLOUDBASE_HTTP_AUTH_VERIFIED !== "true") {
    throw new HttpAuthError(
      "服务端未启用 CloudBase HTTP 网关鉴权，已拒绝不可信身份",
      503,
    );
  }
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new HttpAuthError("请先登录", 401);
  const claims = decodeGatewayVerifiedToken(token);
  if (!claims.exp || claims.exp * 1000 <= Date.now()) throw new HttpAuthError("登录已过期", 401);
  const expectedProject = process.env.NEXT_PUBLIC_CLOUDBASE_ENV_ID?.trim();
  if (expectedProject && claims.project_id !== expectedProject) {
    throw new HttpAuthError("登录凭证不属于当前 CloudBase 环境", 401);
  }
  const userId = claims.user_id || claims.sub;
  if (!userId) throw new HttpAuthError("登录凭证缺少用户身份", 401);
  return { userId, email: claims.email, username: claims.name };
}

export function authErrorResponse(error: unknown): Response {
  const status = error instanceof HttpAuthError ? error.status : 400;
  return Response.json(
    { error: error instanceof Error ? error.message : "请求失败" },
    { status },
  );
}
