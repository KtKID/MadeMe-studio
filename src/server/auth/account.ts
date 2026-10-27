import { z } from "zod";
import type { RuntimeEnv } from "../runtime";
import type { Identity } from "./identity";

/**
 * 返回当前已验证作者的账号名（邮箱），仅供该作者自己的会话展示。
 *
 * - 仅 `google` / `password` 单作者模式：会话只会在登录邮箱与 `OWNER_EMAIL`
 *   一致时颁发（Google 回调同时校验已验证邮箱），因此可直接使用服务端配置值，
 *   无需在 D1 额外存储身份数据。
 * - 未登录、Sites/开发身份或配置不是合法邮箱时返回 null，调用方显示通用文案。
 * - 返回值属于个人信息：只可放进已授权作者自己的响应/页面，绝不写入日志。
 */
export function ownerAccount(
  env: RuntimeEnv,
  identity: Pick<Identity, "owner">,
): string | null {
  if (!identity.owner) return null;
  if (env.AUTH_MODE !== "google" && env.AUTH_MODE !== "password") return null;
  const email = env.OWNER_EMAIL?.trim().toLowerCase();
  return email && z.email().max(254).safeParse(email).success ? email : null;
}
