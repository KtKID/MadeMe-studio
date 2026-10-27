import { MAX_CONTENT_DEPTH } from "../config/limits";
import {
  type EmbedParseResult,
  embedRejectMessage,
  looksLikeEmbedSnippet,
  parseEmbed,
  parseEmbedInput,
} from "../embed";

/**
 * 内容检查模块：保存前（编辑器）与入库前（服务端 validateContent）共用同一套链接规则，
 * 出错时给出“第 N 个视频块……”这样能定位到块的中文原因。纯函数，不记录日志，
 * 调用方经 src/modules/log 记录 reason / blockType / ordinal（绝不记录链接本身）。
 */

export type ContentProblemReason =
  /** 链接不是 https://、mailto:（仅 href）或站内 /api/files/…。 */
  | "unsafe_url"
  /** 作者把 HTML 嵌入代码粘进了链接框。 */
  | "embed_snippet"
  /** 嵌入块的链接不在嵌入注册表里。 */
  | "unsupported_embed";

export interface ContentProblem {
  /** 服务端错误码，保持与旧版一致：UNSAFE_URL / UNSAFE_EMBED。 */
  code: "UNSAFE_URL" | "UNSAFE_EMBED";
  reason: ContentProblemReason;
  /** BlockNote 块 id（若有），编辑器用来滚动定位。 */
  blockId?: string;
  blockType: string;
  /** 在同类块中的序号（文档顺序，从 1 开始，含嵌套子块）。 */
  ordinal: number;
  /** 出问题的字段名：url / href / src。 */
  field: string;
  /** 面向作者的中文说明。 */
  message: string;
  /** 嵌入块被拒绝时的解析结果（reason / host），供调用方写 embed.rejected 日志。 */
  embed?: EmbedParseResult;
}

const blockNames: Record<string, string> = {
  paragraph: "段落",
  heading: "标题",
  quote: "引用",
  bulletListItem: "列表项",
  numberedListItem: "编号列表项",
  checkListItem: "待办项",
  toggleListItem: "折叠列表项",
  codeBlock: "代码块",
  table: "表格",
  image: "图片块",
  video: "视频块",
  audio: "音频块",
  file: "文件块",
  embed: "嵌入块",
};

/** 块类型的中文名，例如 video → 视频块。 */
export function blockLabel(type: string) {
  return blockNames[type] ?? "内容块";
}

const LINK_KEYS = new Set(["url", "href", "src"]);
const LOCAL_MEDIA = /^\/api\/files\/[a-zA-Z0-9-]+$/;

/** 与服务端历来的规则一致：https://、站内上传文件，href 另允许 mailto:。 */
export function isAllowedLink(key: string, value: string) {
  return (
    /^https:\/\//i.test(value) ||
    LOCAL_MEDIA.test(value) ||
    (key === "href" && /^mailto:[^\s<>]+$/.test(value))
  );
}

function linkMessage(type: string, ordinal: number, value: string) {
  const where = `第 ${ordinal} 个${blockLabel(type)}`;
  if (looksLikeEmbedSnippet(value)) {
    const embed = parseEmbedInput(value);
    if (type === "video" && embed.ok && embed.match.provider.content === "post")
      return `${where}里粘贴的是 ${embed.match.provider.name} 的嵌入代码，${embed.match.provider.name} 动态不是视频：请点提示里的“改为嵌入块”。`;
    return `${where}里粘贴的是网页嵌入代码，不是链接。请只粘贴链接，或改用工具栏的“嵌入”按钮。`;
  }
  switch (type) {
    case "video":
      return `${where}的地址不是视频文件或支持的平台链接：请上传视频，或粘贴 https:// 开头的视频直链、YouTube / Bilibili 视频页链接。`;
    case "image":
    case "audio":
    case "file":
      return `${where}的地址无效：请上传文件，或粘贴 https:// 开头的直链。`;
    default:
      return `${where}里的链接无效：只支持 https://、mailto: 或站内上传的文件。`;
  }
}

type Block = {
  id?: unknown;
  type?: unknown;
  props?: unknown;
  content?: unknown;
  children?: unknown;
};

/**
 * 按文档顺序检查所有块（含子块）的链接，返回全部问题。
 * - props / content（含表格单元格与行内链接）里所有 url / href / src 字段都要合规；
 * - 嵌入块的 url 还要通过嵌入注册表 parseEmbed。
 */
export function findContentProblems(blocks: unknown): ContentProblem[] {
  const problems: ContentProblem[] = [];
  const counters = new Map<string, number>();
  function scanFields(
    value: unknown,
    block: { type: string; ordinal: number; id?: string },
    depth: number,
    key = "",
  ) {
    if (depth > MAX_CONTENT_DEPTH) return; // 深度上限由服务端 validateContent 负责报错（同一常量）。
    if (typeof value === "string") {
      if (LINK_KEYS.has(key) && value && !isAllowedLink(key, value))
        problems.push({
          code: "UNSAFE_URL",
          reason: looksLikeEmbedSnippet(value) ? "embed_snippet" : "unsafe_url",
          blockId: block.id,
          blockType: block.type,
          ordinal: block.ordinal,
          field: key,
          message: linkMessage(block.type, block.ordinal, value),
        });
      return;
    }
    if (Array.isArray(value))
      for (const item of value) scanFields(item, block, depth + 1);
    else if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value))
        scanFields(v, block, depth + 1, k);
  }
  function visit(list: unknown, depth: number) {
    if (!Array.isArray(list) || depth > MAX_CONTENT_DEPTH) return;
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const b = raw as Block;
      const type = typeof b.type === "string" ? b.type : "unknown";
      const ordinal = (counters.get(type) ?? 0) + 1;
      counters.set(type, ordinal);
      const info = {
        type,
        ordinal,
        ...(typeof b.id === "string" ? { id: b.id } : {}),
      };
      const before = problems.length;
      scanFields(b.props, info, 0);
      scanFields(b.content, info, 0);
      const url = (b.props as { url?: unknown } | undefined)?.url;
      if (
        type === "embed" &&
        typeof url === "string" &&
        url &&
        problems.length === before
      ) {
        const result = parseEmbed(url);
        if (!result.ok)
          problems.push({
            code: "UNSAFE_EMBED",
            reason: "unsupported_embed",
            blockId: info.id,
            blockType: type,
            ordinal,
            field: "url",
            message: `第 ${ordinal} 个嵌入块：${embedRejectMessage(result.reason)}`,
            embed: result,
          });
      }
      visit(b.children, depth + 1);
    }
  }
  visit(blocks, 0);
  return problems;
}

/** 多个问题时的汇总文案：第一条 +“另有 N 处”。 */
export function summarizeProblems(problems: ContentProblem[]) {
  if (!problems.length) return "";
  const rest = problems.length - 1;
  return rest
    ? `${problems[0].message}（另有 ${rest} 处问题）`
    : problems[0].message;
}

export type VideoAdvice =
  /** 视频块里是 YouTube / Bilibili 的嵌入代码：自动换成规范链接。 */
  | {
      action: "normalize";
      blockId: string;
      ordinal: number;
      url: string;
      provider: string;
    }
  /** 视频块里是 X 动态（链接或嵌入代码）：建议一键改为嵌入块。 */
  | {
      action: "convert";
      blockId: string;
      ordinal: number;
      url: string;
      provider: string;
      message: string;
    }
  /** 视频块里是认不出的嵌入代码：建议移除或重新粘贴。 */
  | { action: "invalid"; blockId: string; ordinal: number; message: string };

/**
 * 检查视频块里粘贴的平台链接 / 嵌入代码，给出编辑器提示与一键修正方案。
 * 序号与 findContentProblems 一致（视频块按文档顺序计数）。
 */
export function adviseVideoBlocks(blocks: unknown): VideoAdvice[] {
  const advice: VideoAdvice[] = [];
  let ordinal = 0;
  function visit(list: unknown) {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const b = raw as Block;
      if (b.type === "video" && typeof b.id === "string") {
        ordinal++;
        const url = (b.props as { url?: unknown } | undefined)?.url;
        if (typeof url === "string" && url.trim()) {
          const result = parseEmbedInput(url);
          const where = `第 ${ordinal} 个视频块`;
          if (result.ok && result.match.provider.content === "post")
            advice.push({
              action: "convert",
              blockId: b.id,
              ordinal,
              url: result.match.canonicalUrl,
              provider: result.match.provider.id,
              message: `${where}里是 ${result.match.provider.name} 动态${result.fromSnippet ? "的嵌入代码" : "链接"}，不是视频，阅读页无法播放。`,
            });
          else if (result.ok && result.fromSnippet)
            advice.push({
              action: "normalize",
              blockId: b.id,
              ordinal,
              url: result.match.canonicalUrl,
              provider: result.match.provider.id,
            });
          else if (!result.ok && result.fromSnippet)
            advice.push({
              action: "invalid",
              blockId: b.id,
              ordinal,
              message: `${where}里粘贴的是网页嵌入代码，${embedRejectMessage(result.reason)}`,
            });
        }
      }
      visit(b.children);
    }
  }
  visit(blocks);
  return advice;
}
