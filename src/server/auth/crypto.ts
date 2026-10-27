import { logCaught } from "../../modules/log/server";
import {
  OPAQUE_TOKEN_BYTES,
  OPAQUE_TOKEN_PREFIX,
  POST_PASSWORD_KDF_ACCEPTED,
  POST_PASSWORD_KDF_ITERATIONS,
} from "../../modules/config";
const encoder = new TextEncoder();
function hex(bytes: Uint8Array) {
  return [...bytes].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function unhex(s: string) {
  if (!/^[0-9a-f]+$/i.test(s) || s.length % 2)
    throw new Error("Malformed hash");
  return Uint8Array.from(s.match(/.{2}/g)!, (v) => parseInt(v, 16));
}
export async function sha256(value: string) {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
}
/**
 * 文章密码摘要：`pbkdf2:<迭代次数>:<盐>:<摘要>`。
 * 迭代次数见 POST_PASSWORD_KDF_ITERATIONS（Cloudflare 生产 Workers 上限 100000）；
 * 校验按 POST_PASSWORD_KDF_ACCEPTED 白名单读取存量摘要里的次数，以后提高次数时旧摘要仍可校验。
 */
export async function hashPassword(
  value: string,
  iterations: number = POST_PASSWORD_KDF_ITERATIONS,
) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(value),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2:${iterations}:${hex(salt)}:${hex(new Uint8Array(hash))}`;
}
export async function verifyPassword(value: string, stored: string) {
  try {
    const [scheme, iterations, salt, expected] = stored.split(":");
    const rounds = Number(iterations);
    if (
      scheme !== "pbkdf2" ||
      !/^\d+$/.test(iterations ?? "") ||
      !(POST_PASSWORD_KDF_ACCEPTED as readonly number[]).includes(rounds)
    )
      return false;
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(value),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const hash = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: unhex(salt),
        iterations: rounds,
        hash: "SHA-256",
      },
      key,
      256,
    );
    return constantTimeEqual(hex(new Uint8Array(hash)), expected);
  } catch (error) {
    // 存储的摘要损坏或 KDF 不可用：仍按校验失败处理，但必须留下日志，避免误判为"密码错误"。
    logCaught("auth.post_password_verify_failed", error, {}, "error");
    return false;
  }
}
export function constantTimeEqual(a: string, b: string) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return difference === 0;
}
export function randomToken() {
  return `${OPAQUE_TOKEN_PREFIX}${hex(crypto.getRandomValues(new Uint8Array(OPAQUE_TOKEN_BYTES)))}`;
}
export async function hmac(message: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
    ),
  );
}
