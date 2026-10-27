/** 嵌入模块的公共类型。只依赖 Web 标准 URL，可在 Workers、浏览器与 Node 测试中运行。 */

/** iframe 属性。sandbox 留空表示不加 sandbox（只在提供方与沙箱不兼容时使用）。 */
export interface EmbedFrameConfig {
  /** iframe title，供读屏器使用。 */
  title: string;
  /** Permissions-Policy 的 allow 属性。 */
  allow: string;
  sandbox?: string;
  referrerPolicy: "strict-origin-when-cross-origin" | "no-referrer" | "origin";
  /** CSS aspect-ratio，例如 "16 / 9"。与 initialHeight 二选一。 */
  aspectRatio?: string;
  /**
   * 高度随内容变化的播放器（如 X 动态）：初始高度（px），之后由 autoHeight.ts
   * 根据提供方 postMessage 的高度调整。
   */
  initialHeight?: number;
}

/** 提供方从 URL 中解析出的结果：内容 id 与可选的分P / 起始秒数。 */
export interface EmbedTarget {
  id: string;
  /** 多 P 视频的集数（从 1 开始），仅部分提供方支持。 */
  part?: number;
  /** 起始时间（秒）。 */
  start?: number;
  /** 作者用户名（X 动态链接里的 handle），只用于规范链接与卡片文案。 */
  handle?: string;
}

export type EmbedRejectReason =
  | "not_string"
  | "invalid_url"
  | "not_https"
  | "credentials"
  | "port"
  | "unsupported_host"
  | "short_link_unsupported"
  | "invalid_path"
  | "invalid_id"
  | "snippet_without_link"
  | "too_long";

/** 一个提供方 = 一条配置。新增平台只需新增一个 providers/*.ts 并登记到 registry。 */
export interface EmbedProvider {
  /** 稳定 id，写入日志与 data-embed 属性。 */
  id: string;
  /** 面向作者/读者的显示名。 */
  name: string;
  /** 精确匹配的主机名（小写，不做后缀匹配，防止 bilibili.com.evil.com）。 */
  hostnames: readonly string[];
  /** 需要跳转解析的短链主机：明确拒绝并提示作者粘贴完整链接，渲染期绝不跟随跳转。 */
  shortLinkHosts?: readonly string[];
  /**
   * "iframe"：站内播放器；"link"：只渲染安全跳转卡片（如 X）。
   */
  kind: "iframe" | "link";
  /**
   * 内容类别："video" 可以放进视频块；"post"（如 X 动态）只能用嵌入块，
   * 粘进视频块时编辑器提示“改为嵌入块”。
   */
  content: "video" | "post";
  /** iframe 允许的来源，汇总后写入 CSP frame-src。link 类为空。 */
  frameOrigins: readonly string[];
  frame?: EmbedFrameConfig;
  /** 跳转卡片文案，例如“在 X 上阅读这条动态”。 */
  linkLabel?: string;
  /** 在主机名已匹配的前提下解析路径与参数；id 必须经正则严格校验。 */
  parse(url: URL): EmbedTarget | { reason: "invalid_path" | "invalid_id" };
  /** 由已校验的 target 构造播放器地址（iframe 类必填）。 */
  playerUrl?(target: EmbedTarget): string;
  /** 由已校验的 target 构造去掉追踪参数的规范链接；不提供时使用原链接。 */
  canonicalUrl?(target: EmbedTarget): string;
}

export interface EmbedMatch {
  provider: EmbedProvider;
  target: EmbedTarget;
  /** 规范化后的原始链接（URL.href）。 */
  url: string;
  /** 去掉追踪参数、由 id 重新拼出的规范链接（从嵌入代码中识别时保存这个）。 */
  canonicalUrl: string;
  /** iframe 播放器地址；link 类为 undefined。 */
  playerUrl?: string;
}

export type EmbedParseResult =
  | { ok: true; match: EmbedMatch }
  | { ok: false; reason: EmbedRejectReason; host?: string };
