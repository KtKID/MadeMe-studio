/**
 * 嵌入模块入口：提供方注册表、严格 URL 解析、CSP frame-src 来源与拒绝日志。
 * 编辑器、服务端校验、阅读页渲染与响应头都从这里取同一份规则。
 */
export {
  embedProviders,
  parseEmbed,
  embedFrameOrigins,
  supportedEmbedLabel,
  embedRejectMessage,
} from "./registry";
export { reportEmbedRejection } from "./log";
export type {
  EmbedProvider,
  EmbedFrameConfig,
  EmbedTarget,
  EmbedMatch,
  EmbedParseResult,
  EmbedRejectReason,
} from "./types";
