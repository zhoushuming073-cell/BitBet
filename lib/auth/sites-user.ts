export interface SiteUserIdentity {
  userId: string;
  email?: string;
  displayName: string;
}

/** Identity is injected by the Sites/ChatGPT gateway; client payloads are ignored. */
export function requireSiteUser(request: Request): SiteUserIdentity {
  const userId = request.headers.get("oai-authenticated-user-id")?.trim();
  const email = request.headers.get("oai-authenticated-user-email")?.trim();
  const encodedName = request.headers.get("oai-authenticated-user-full-name")?.trim();
  const nameEncoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  if (userId) {
    let fullName: string | null = null;
    if (encodedName && nameEncoding === "percent-encoded-utf-8") {
      try { fullName = decodeURIComponent(encodedName); } catch { fullName = null; }
    }
    return { userId, email: email || undefined, displayName: fullName || email || "你" };
  }
  if (process.env.NODE_ENV !== "production") {
    const devId = request.headers.get("x-bitbet-dev-user-id")?.trim() || "bitbet-local-preview";
    return { userId: devId, displayName: "本地玩家" };
  }
  throw new Error("AUTH_REQUIRED");
}

export function siteAuthError(error: unknown) {
  if (process.env.NODE_ENV !== "production") console.error("[authority]", error);
  const message = error instanceof Error ? error.message : "请求失败";
  return Response.json(
    { error: message === "AUTH_REQUIRED" ? "请使用 ChatGPT 登录后继续" : message },
    { status: message === "AUTH_REQUIRED" ? 401 : 400 },
  );
}
