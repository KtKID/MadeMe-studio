/**
 * 嵌入模块入口：提供方注册表、严格 URL 解析、嵌入代码识别、CSP frame-src 来源、
 * 自适应高度与拒绝日志。编辑器、服务端校验、阅读页渲染与响应头都从这里取同一份规则。
 */
export {
  embedProviders,
  parseEmbed,
  embedFrameOrigins,
  supportedEmbedLabel,
  videoEmbedProviderNames,
  embedRejectMessage,
} from "./registry";
export {
  parseEmbedInput,
  looksLikeEmbedSnippet,
  MAX_EMBED_INPUT_LENGTH,
  type EmbedInputResult,
} from "./snippet";
export { installEmbedAutoHeight, readResizeMessage } from "./autoHeight";
export { reportEmbedRejection } from "./log";
export type {
  EmbedProvider,
  EmbedFrameConfig,
  EmbedTarget,
  EmbedMatch,
  EmbedParseResult,
  EmbedRejectReason,
} from "./types";
