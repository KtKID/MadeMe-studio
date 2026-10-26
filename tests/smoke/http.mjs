import assert from "node:assert/strict";
// 真实 HTTP 冒烟：请先启动开发服务，不能把未执行标记为成功。
const origin = process.env.BASE_URL || "http://127.0.0.1:4321";
const page = await fetch(origin);
assert.equal(page.status, 200);
assert.match(await page.text(), /MadeMe Studio/);
const health = await fetch(`${origin}/api/health`);
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), {
  status: "ok",
  service: "MadeMe Studio",
  version: "0.1.0",
});
console.log("HTTP 冒烟通过");
