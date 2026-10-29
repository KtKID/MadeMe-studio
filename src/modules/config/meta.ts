/**
 * 设置页展示用的元数据：中文名称、单位、说明、分组。与 schema.ts 的范围一一对应。
 * 新增一项配置时，在 defaults.ts / schema.ts / meta.ts 各加一行（见 README）。
 */
import type { ConfigGroup } from "./schema.ts";

export type FieldMeta = {
  label: string;
  unit: string;
  description: string;
  /** 读者端也会用到（会随公开页面下发）。其余字段只下发给作者。 */
  reader?: boolean;
};

export const GROUP_META: Record<
  ConfigGroup,
  { label: string; description: string; tab: SettingsConfigTab }
> = {
  upload: {
    label: "上传",
    description: "单个文件上限、允许上传的文件类型与 Markdown 导入上限。",
    tab: "media",
  },
  media: {
    label: "媒体库与版本",
    description: "媒体库展示条数、图片裁剪输出与版本历史条数。",
    tab: "media",
  },
  ai: {
    label: "AI 用量",
    description: "限流与超时，防止误操作刷爆供应商额度。",
    tab: "ai",
  },
  security: {
    label: "账号与安全",
    description: "登录会话、文章解锁与 API 令牌的有效期。",
    tab: "security",
  },
  reading: {
    label: "嵌入与阅读",
    description: "读者看到的嵌入、卡片与 RSS。",
    tab: "reading",
  },
};

/** 设置页中的四个配置分组（标签页）。 */
export type SettingsConfigTab = "media" | "ai" | "security" | "reading";
export const CONFIG_TABS: { id: SettingsConfigTab; label: string; groups: ConfigGroup[] }[] = [
  { id: "media", label: "上传与媒体", groups: ["upload", "media"] },
  { id: "ai", label: "AI 用量", groups: ["ai"] },
  { id: "security", label: "账号与安全", groups: ["security"] },
  { id: "reading", label: "嵌入与阅读", groups: ["reading"] },
];

export const FIELD_META = {
  upload: {
    imageMaxMB: { label: "图片单个文件上限", unit: "MB", description: "PNG、JPEG、WebP、GIF、AVIF。" },
    videoMaxMB: { label: "视频单个文件上限", unit: "MB", description: "MP4、WebM、MOV。" },
    audioMaxMB: { label: "音频单个文件上限", unit: "MB", description: "MP3、WAV、OGG、M4A。" },
    documentMaxMB: { label: "文档单个文件上限", unit: "MB", description: "PDF、EPUB、ZIP、Office、TXT、Markdown、CSV。" },
    disabledTypes: { label: "允许上传的文件类型", unit: "", description: "取消勾选的格式会在编辑器与服务端同时拒绝上传；已上传的文件不受影响。" },
    markdownImportMaxKB: { label: "Markdown 导入上限", unit: "KB", description: "编辑器“导入 Markdown”的文件大小上限；导入后正文仍受服务端正文长度限制。" },
  },
  media: {
    listLimit: { label: "媒体库展示条数", unit: "条", description: "媒体库一次列出最近的多少个文件。" },
    cropOutputWidth: { label: "裁剪输出最大宽度", unit: "px", description: "裁剪后生成的新图片最宽多少像素。" },
    cropJpegQuality: { label: "裁剪 JPEG 质量", unit: "%", description: "数值越高越清晰、文件越大。" },
    revisionsLimit: { label: "版本历史展示条数", unit: "条", description: "编辑器“历史版本”面板最多列出多少条。" },
  },
  ai: {
    textPerMinute: { label: "文字 AI 每分钟次数", unit: "次/分钟", description: "润色、改写、摘要等文字操作的限流。" },
    imagesPer5Minutes: { label: "生成图片每 5 分钟次数", unit: "次/5 分钟", description: "AI 生成图片的限流。" },
    requestTimeoutSeconds: { label: "AI 请求超时", unit: "秒", description: "等待供应商响应的最长时间。" },
  },
  security: {
    sessionHours: { label: "登录会话时长", unit: "小时", description: "作者登录（Google / 密码）后多久需要重新登录；只影响之后的新登录。" },
    unlockMinutes: { label: "文章解锁有效期", unit: "分钟", description: "读者输入文章密码后，多久内不用再输。" },
    tokenDefaultDays: { label: "API 令牌默认有效期", unit: "天", description: "新建令牌时预填的有效期，不能超过最长有效期。" },
    tokenMaxDays: { label: "API 令牌最长有效期", unit: "天", description: "新建令牌允许填写的最大天数。" },
  },
  reading: {
    disabledEmbeds: { label: "允许的嵌入平台", unit: "", description: "取消勾选后编辑器不能再插入该平台；已有文章里的该平台嵌入会显示为跳转卡片。", reader: true },
    xFallbackSeconds: { label: "X 动态加载等待", unit: "秒", description: "超过该时间仍未加载出来，就只显示跳转链接。", reader: true },
    xInitialHeight: { label: "X 动态初始高度", unit: "px", description: "加载完成前预留的高度。", reader: true },
    cardTags: { label: "文章卡片显示标签数", unit: "个", description: "首页卡片上最多显示几个标签。", reader: true },
    rssItems: { label: "RSS 条目数", unit: "条", description: "RSS 输出最近的多少篇公开文章。" },
  },
} as const satisfies Record<ConfigGroup, Record<string, FieldMeta>>;
