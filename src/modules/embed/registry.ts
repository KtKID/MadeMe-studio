import { bilibili } from "./providers/bilibili";
import { x } from "./providers/x";
import { youtube } from "./providers/youtube";
import type { EmbedParseResult, EmbedProvider } from "./types";

/**
 * 嵌入提供方注册表：编辑器、服务端内容校验、阅读页渲染与 CSP frame-src 的唯一来源。
 * 以后若要改为可配置，只需让这里的数组来自设置（并保持每项仍经代码内的 parse 严格校验）。
 */
export const embedProviders: readonly EmbedProvider[] = [youtube, bilibili, x];

const byHost = new Map<string, EmbedProvider>();
const shortHosts = new Map<string, EmbedProvider>();
for (const provider of embedProviders) {
  for (const host of provider.hostnames) byHost.set(host, provider);
  for (const host of provider.shortLinkHosts ?? [])
    shortHosts.set(host, provider);
}

/**
 * 严格解析一条嵌入链接。要求：绝对 https URL、无用户名密码、无显式端口、
 * 主机名与提供方清单精确相等（不做后缀匹配）、路径与 id 通过提供方正则。
 * 纯函数，不记录日志：调用方按场景决定是否经 src/modules/log 记录 reason/host。
 */
export function parseEmbed(value: unknown): EmbedParseResult {
  if (typeof value !== "string") return { ok: false, reason: "not_string" };
  let u: URL;
  try {
    // 不提供基址：协议相对 "//host/..." 与相对路径都会解析失败。
    u = new URL(value.trim());
  } catch {
    // 判定函数：无效 URL 以 reason 返回，由调用方记录。
    return { ok: false, reason: "invalid_url" };
  }
  const host = u.hostname;
  if (u.protocol !== "https:") return { ok: false, reason: "not_https", host };
  if (u.username || u.password)
    return { ok: false, reason: "credentials", host };
  if (u.port) return { ok: false, reason: "port", host };
  if (shortHosts.has(host))
    return { ok: false, reason: "short_link_unsupported", host };
  const provider = byHost.get(host);
  if (!provider) return { ok: false, reason: "unsupported_host", host };
  const target = provider.parse(u);
  if ("reason" in target) return { ok: false, reason: target.reason, host };
  return {
    ok: true,
    match: {
      provider,
      target,
      url: u.href,
      playerUrl:
        provider.kind === "iframe" ? provider.playerUrl?.(target) : undefined,
    },
  };
}

/** 所有 iframe 提供方的允许来源（去重、排序），用于 CSP frame-src。 */
export function embedFrameOrigins(): string[] {
  return [...new Set(embedProviders.flatMap((p) => p.frameOrigins))].sort();
}

/** 面向作者的支持清单文案，例如 "YouTube、Bilibili 视频与 X 动态"。 */
export function supportedEmbedLabel(): string {
  const video = embedProviders
    .filter((p) => p.kind === "iframe")
    .map((p) => p.name);
  const links = embedProviders
    .filter((p) => p.kind === "link")
    .map((p) => p.name);
  return `${video.join("、")} 视频${links.length ? `与 ${links.join("、")} 动态` : ""}`;
}

/** 面向作者的拒绝原因。 */
export function embedRejectMessage(reason: string): string {
  switch (reason) {
    case "short_link_unsupported":
      return "暂不支持短链接（如 b23.tv），请在浏览器打开后复制完整的视频页地址。";
    case "not_https":
      return "嵌入链接必须以 https:// 开头。";
    case "unsupported_host":
      return `暂不支持该网站，目前支持 ${supportedEmbedLabel()}。`;
    case "invalid_id":
    case "invalid_path":
      return "没有识别出视频或动态编号，请复制完整的内容页地址。";
    default:
      return "链接格式无效。";
  }
}
