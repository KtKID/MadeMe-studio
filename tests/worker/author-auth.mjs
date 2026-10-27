import assert from "node:assert/strict";
import { devOrigin, SECOND_PORT } from "../../scripts/dev-config.mjs";
const base = process.env.BASE_URL || devOrigin();
const secondBase = process.env.SECOND_BASE_URL || devOrigin(SECOND_PORT);
async function request(path, { method = "GET", body, headers = {} } = {}) {
  return fetch(base + path, {
    method,
    headers: {
      Origin: base,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const owner = { "oai-authenticated-user-id": "isolated-sites-owner" };
assert.deepEqual(await (await request("/api/auth/session")).json(), {
  mode: "sites",
  configured: true,
  authenticated: false,
});
assert.deepEqual(
  await (await request("/api/auth/session", { headers: owner })).json(),
  { mode: "sites", configured: true, authenticated: true },
);
const issue = await request("/api/tokens", {
  method: "POST",
  headers: owner,
  body: {
    name: "isolated read token",
    scopes: ["posts:read"],
    expiresInDays: 1,
  },
});
assert.equal(issue.status, 201);
const issued = await issue.json();
const token = issued;
assert.equal(typeof token.token, "string");
const headers = { ...owner, Authorization: `Bearer ${token.token}` };
assert.equal(
  (await (await request("/api/auth/session", { headers })).json())
    .authenticated,
  false,
);
assert.equal((await request("/api/posts", { headers })).status, 200);
assert.equal(
  (await request("/api/settings", { method: "PATCH", headers, body: {} }))
    .status,
  403,
);
assert.equal(
  (
    await request(`/api/tokens/${token.id}`, {
      method: "DELETE",
      headers: owner,
    })
  ).status,
  200,
);
assert.equal((await request("/api/posts", { headers })).status, 401);
const independent = await fetch(`${secondBase}/api/auth/session`, {
  headers: owner,
});
assert.deepEqual(await independent.json(), {
  mode: "password",
  configured: false,
  authenticated: false,
});
const page = await fetch(`${secondBase}/login`);
assert.equal(page.status, 200);
assert.ok(
  page.headers
    .get("content-security-policy")
    .includes("frame-ancestors 'none'"),
);
assert.ok(!(await page.text()).includes('type="password"'));
console.log(
  "真实 Worker 认证回归通过：Sites作者/访客、Bearer优先与scope、撤销、独立模式缺配置/HTTP不展示密码。未验证独立HTTPS登录或生产KDF支持。",
);
