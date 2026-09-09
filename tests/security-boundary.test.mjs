import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => vite.close());

test("开发身份只能来自专用 header，不读取 body userId", async () => {
  const { requireUser } = await vite.ssrLoadModule("/lib/auth/require-user.ts");
  const request = new Request("http://localhost/api", { headers: { "x-bitbet-dev-user-id": "dev-a" } });
  assert.deepEqual(requireUser(request), { userId: "dev-a" });
});

test("未声明网关已验签时 bearer token fail closed", async () => {
  const { requireUser } = await vite.ssrLoadModule("/lib/auth/require-user.ts");
  const previous = process.env.CLOUDBASE_HTTP_AUTH_VERIFIED;
  delete process.env.CLOUDBASE_HTTP_AUTH_VERIFIED;
  try {
    assert.throws(() => requireUser(new Request("http://localhost/api", {
      headers: { authorization: "Bearer fake.jwt.value" },
    })), /未启用 CloudBase HTTP 网关鉴权/);
  } finally {
    if (previous === undefined) delete process.env.CLOUDBASE_HTTP_AUTH_VERIFIED;
    else process.env.CLOUDBASE_HTTP_AUTH_VERIFIED = previous;
  }
});

test("客户端价格回退必须同时是非 production 且显式开启", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(`${root}/lib/game/market-price-provider.ts`, "utf8");
  const previous = process.env.ALLOW_CLIENT_MARKET_PRICE_DEV;
  delete process.env.ALLOW_CLIENT_MARKET_PRICE_DEV;
  assert.match(source, /process\.env\.NODE_ENV !== "production"/);
  assert.match(source, /ALLOW_CLIENT_MARKET_PRICE_DEV === "true"/);
  assert.match(source, /data-api\.binance\.vision/);
  assert.match(source, /api\.kraken\.com\/0\/public/);
  if (previous === undefined) delete process.env.ALLOW_CLIENT_MARKET_PRICE_DEV;
  else process.env.ALLOW_CLIENT_MARKET_PRICE_DEV = previous;
});

test("机器人与网页共用服务端发布的公开行情快照", async () => {
  const fs = await import("node:fs/promises");
  const authority = await fs.readFile(`${root}/lib/pulse5/server/ServerAuthority.ts`, "utf8");
  const client = await fs.readFile(`${root}/components/pulse5/market-game.tsx`, "utf8");
  const orderClient = await fs.readFile(`${root}/lib/game/authority-client.ts`, "utf8");
  assert.match(authority, /market: market \? \{ \.\.\.market \} : null/);
  assert.match(authority, /priceSamples: market\.priceSamples\.filter\(\(sample\) => sample\.time <= now\)/);
  assert.match(client, /runtime\.engine\.mergeChart\(state\.market\.priceSamples\)/);
  assert.match(client, /runtime\.engine\.onBookTicker\(state\.market\.bid, state\.market\.ask/);
  assert.doesNotMatch(orderClient, /clientPrice|displayPrice|marketPrice/);
});

test("未登录时停止轮询，避免反复产生 401 请求", async () => {
  const fs = await import("node:fs/promises");
  const client = await fs.readFile(`${root}/components/pulse5/market-game.tsx`, "utf8");
  assert.match(client, /return status !== 401/);
  assert.match(client, /if \(shouldContinue && !controller\.signal\.aborted\)/);
});
