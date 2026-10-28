import assert from "node:assert/strict";
// 真实 HTTP 冒烟：由隔离运行器启动构建后的本地服务。
import { devOrigin } from "../../scripts/dev-config.mjs";
import { PRODUCT_VERSION } from "../../src/modules/config/product.ts";
const origin = process.env.BASE_URL || devOrigin();
const page = await fetch(origin);
assert.equal(page.status, 200);
const html = await page.text();
assert.match(html, /<title>MadeMe(?:\s|·)/);
assert.ok(html.includes(`Powered by MadeMe · v${PRODUCT_VERSION}`));
assert.ok(!html.includes("Made with intention"));
const health = await fetch(`${origin}/api/health`);
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), {
  status: "ok",
  service: "MadeMe Studio",
  version: "0.1.0",
});
console.log("HTTP 冒烟通过");
