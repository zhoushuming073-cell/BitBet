import { getAuthAdapter } from "@/lib/cloudbase/auth";

export async function authenticatedFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAuthAdapter().getAccessToken();
  if (!token) throw new Error("请先登录正式账号");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}
