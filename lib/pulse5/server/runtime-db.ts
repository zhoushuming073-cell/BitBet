import { env } from "cloudflare:workers";
import type { D1Like } from "./ActorLedgerRepository";

export function getRuntimeDb(): D1Like | null {
  const binding = (env as unknown as { DB?: D1Like }).DB;
  if (binding) return binding;
  if (process.env.NODE_ENV === "production") throw new Error("D1 权威数据库不可用");
  return null;
}
