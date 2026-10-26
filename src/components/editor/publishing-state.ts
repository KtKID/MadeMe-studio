import type { Visibility } from "../../shared/contracts";
export function initialPublishVisibility(
  visibility: Visibility | undefined,
): Exclude<Visibility, "draft"> {
  return visibility === "password"
    ? "password"
    : visibility === "unlisted"
      ? "unlisted"
      : "public";
}
/** 配置缺失只阻止新的密码发布，不改写文章现有可见性，也不限制草稿保存。 */
export function publicationAvailability(
  visibility: Exclude<Visibility, "draft">,
  passwordConfigured: boolean,
) {
  return visibility === "password" && !passwordConfigured
    ? {
        allowed: false,
        message:
          "密码发布尚未配置：请在服务器 Secrets 中安全设置至少 32 字符的 SESSION_SECRET。现有草稿仍可保存；不会自动改为公开。",
      }
    : { allowed: true, message: "" };
}
