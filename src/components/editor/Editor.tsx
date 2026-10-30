import TypeSelector from "../../modules/article-types/TypeSelector";
import ObsidianSaveButton from "../../modules/obsidian-local/SaveButton";
import { useEffect, useRef, useState } from "react";
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  type PartialBlock,
} from "@blocknote/core";
import {
  useCreateBlockNote,
  createReactBlockSpec,
  FormattingToolbar,
  FormattingToolbarController,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Download,
  FileUp,
  Globe2,
  History,
  ImagePlus,
  Link,
  Save,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  api,
  ApiError,
  type Post,
  type Settings,
  type Media,
  Notice,
  Modal,
  Busy,
  downloadText,
  date,
} from "../shared/ui";
import type { EditorBlock, AIAction, Revision } from "../../shared/contracts";
import { mediaUploadProblem } from "../../shared/contracts";
import {
  DEFAULT_CONFIG,
  KiB,
  MAX_DOCUMENT_CHARS,
  formatBytes,
  uploadHint,
  type UploadConfig,
} from "../../modules/config";
import { clientCaught, clientLog } from "../../modules/log/client";
import { SafeEmbed } from "../content/BlockReader";
import {
  embedRejectMessage,
  installEmbedAutoHeight,
  parseEmbedInput,
  reportEmbedRejection,
  supportedEmbedLabel,
  videoEmbedProviderNames,
} from "../../modules/embed";
import {
  adviseVideoBlocks,
  findContentProblems,
  summarizeProblems,
  type VideoAdvice,
} from "../../modules/content-check";
import { describeEditorError, type EditorAction } from "./errors";
import { en as blockNoteEn } from "@blocknote/core/locales";
import MediaLibrary from "../media/MediaLibrary";
import CoverFrame from "../../modules/cover/CoverFrame";
import CoverAdjuster from "../../modules/cover/CoverAdjuster";
import {
  DEFAULT_COVER_SETTINGS,
  normalizeCoverSettings,
  resetCoverFraming,
  type CoverSettings,
} from "../../modules/cover/contracts";
import { resolveMode } from "../shared/appearance";
import { EditClock, hasDocumentContent } from "./editor-state";
import { AIRequestState } from "./ai-request-state";
import { applyEditorReplacement } from "./editor-replacement";
import {
  createEditorLeaveGuard,
  editorLinkDestination,
} from "./editor-navigation";
import {
  initialPublishVisibility,
  publicationAvailability,
} from "./publishing-state";
const embed = createReactBlockSpec(
  { type: "embed", propSchema: { url: { default: "" } }, content: "none" },
  { render: ({ block }) => <SafeEmbed url={block.props.url} /> },
);
const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, embed: embed() },
});
/**
 * 媒体块面板文案：视频块同时支持“从电脑上传”和“粘贴链接”（直链文件或嵌入注册表中的平台）。
 * 只覆盖 file_panel，其余沿用 BlockNote 英文默认。
 */
const blockNoteDictionary = (upload: UploadConfig) => ({
  ...blockNoteEn,
  file_panel: {
    upload: {
      ...blockNoteEn.file_panel.upload,
      title: "从电脑上传",
      // 格式与大小文案由设置页配置生成（src/modules/config uploadHint），不在这里写死数值。
      file_placeholder: {
        ...blockNoteEn.file_panel.upload.file_placeholder,
        image: `选择图片（${uploadHint(upload, "image")}）`,
        video: `选择视频文件（${uploadHint(upload, "video")}）`,
        audio: `选择音频文件（${uploadHint(upload, "audio")}）`,
        file: `选择文件（${uploadHint(upload, "document")}）`,
      },
      upload_error: "上传失败，原因见编辑器顶部提示",
    },
    embed: {
      ...blockNoteEn.file_panel.embed,
      title: "粘贴链接",
      embed_button: {
        ...blockNoteEn.file_panel.embed.embed_button,
        image: "插入图片",
        video: "插入视频",
        audio: "插入音频",
        file: "插入文件",
      },
      url_placeholder: `文件直链，或 ${videoEmbedProviderNames().join(" / ")} 视频页链接`,
    },
  },
});
const actionNames: Record<AIAction, string> = {
  rewrite: "换一种说法",
  polish: "润色文字",
  expand: "展开写写",
  translate: "翻译为英文",
  title: "拟定标题",
  excerpt: "生成摘要",
  tags: "提取标签",
  slug: "生成链接",
};
type Props = {
  post?: Post;
  settings: Settings;
  authenticated: boolean;
  aiConfigured: boolean;
  imageConfigured?: boolean;
  passwordConfigured?: boolean;
  inline?: boolean;
  onClose?: () => void;
  onPublished?: (post: Post) => void;
};
export default function Editor({
  post,
  settings,
  authenticated,
  aiConfigured,
  imageConfigured = false,
  passwordConfigured = false,
  inline = false,
  onClose,
  onPublished,
}: Props) {
  // 设置页配置（上传上限、Markdown 导入上限、关闭的嵌入平台等）；旧客户端缺字段时回退默认值。
  const limits = settings.limits ?? DEFAULT_CONFIG;
  const [current, setCurrent] = useState(post);
  const currentRef = useRef(post);
  const localArticleId = useRef<string | null>(null);
  const editClock = useRef(new EditClock());
  function updateCurrent(value: Post) {
    currentRef.current = value;
    setCurrent(value);
  }
  function markDirty() {
    editClock.current.edit();
    setDirty(true);
    setMessage("");
  }
  function markClean() {
    editClock.current.reset();
    setDirty(false);
  }

  const [resolvedMode, setResolvedMode] = useState<"light" | "dark">(() =>
    resolveMode(
      settings.mode,
      typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches,
    ),
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      setResolvedMode(resolveMode(settings.mode, media.matches));
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.mode]);
  const [title, setTitle] = useState(post?.title || "");
  const [excerpt, setExcerpt] = useState(post?.excerpt || "");
  const [category, setCategory] = useState(post?.category || "");
  const [categoryId, setCategoryId] = useState<string | null | undefined>(
    post?.categoryId,
  );
  const [tags, setTags] = useState(post?.tags.join(", ") || "");
  const [slug, setSlug] = useState(post?.slug || "");
  const [cover, setCover] = useState(post?.coverImage || "");
  const [coverSettings, setCoverSettings] = useState<CoverSettings>(() =>
    normalizeCoverSettings(post?.coverSettings),
  );
  /** “调整封面”弹窗中的未确认设置；取消即丢弃。 */
  const [coverDraft, setCoverDraft] = useState<CoverSettings | null>(null);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [visibility, setVisibility] = useState(() =>
    initialPublishVisibility(post?.visibility),
  );
  const publication = publicationAvailability(visibility, passwordConfigured);
  const [password, setPassword] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [panel, setPanel] = useState<
    "meta" | "media" | "ai" | "revisions" | null
  >(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedValue, setEmbedValue] = useState("");
  // 嵌入弹窗同时接受链接与官方嵌入代码；嵌入代码只取出链接，本身不保存、不渲染。
  const embedCheck = parseEmbedInput(embedValue);
  const embedInsertUrl = embedCheck.ok
    ? embedCheck.fromSnippet
      ? embedCheck.match.canonicalUrl
      : embedCheck.match.url
    : "";
  // 设置页“嵌入与阅读”里关闭的平台：不允许新插入（已有文章仍可保存，阅读页显示为跳转卡片）。
  const embedDisabled =
    embedCheck.ok &&
    limits.reading.disabledEmbeds.includes(embedCheck.match.provider.id);
  const [videoAdvice, setVideoAdvice] = useState<
    Exclude<VideoAdvice, { action: "normalize" }>[]
  >([]);
  const errorRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState("");
  const [aiAction, setAiAction] = useState<AIAction>("polish");
  const [aiText, setAiText] = useState("");
  const aiSession = useRef(new AIRequestState());
  const [provider, setProvider] = useState("");
  const [promptId, setPromptId] = useState("");
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const importInput = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveGuardRef = useRef<ReturnType<
    typeof createEditorLeaveGuard
  > | null>(null);
  if (!leaveGuardRef.current)
    leaveGuardRef.current = createEditorLeaveGuard({
      isDirty: () => editClock.current.dirty,
      isBusy: () => lock.current,
      show: setLeaveOpen,
    });
  const leaveGuard = leaveGuardRef.current;
  const editor = useCreateBlockNote({
    schema,
    dictionary: blockNoteDictionary(limits.upload),
    initialContent: post?.blocks.length
      ? (post.blocks as unknown as PartialBlock<typeof schema.blockSchema>[])
      : undefined,
    uploadFile: async (file) => {
      // BlockNote 上传面板吞掉异常、只显示通用“上传失败”，块会以空 url 留在正文里；
      // 因此拒绝原因必须由这里写日志并显示到编辑器提示栏，避免失败静默。
      const problem = mediaUploadProblem(file, limits.upload);
      if (problem) {
        clientLog("warn", "editor.upload_rejected", {
          reason: problem.reason,
          mime: file.type || "unknown",
          size: file.size,
        });
        setError(problem.message);
        throw new Error(problem.message);
      }
      const form = new FormData();
      form.append("file", file);
      if (current?.id) form.append("postId", current.id);
      try {
        const { media } = await api<{ media: Media }>("/api/media", {
          method: "POST",
          body: form,
        });
        return media.url;
      } catch (e) {
        // api() 已经记录 api.request_failed / api.network_failed，这里只负责展示。
        setError(`上传失败：${(e as Error).message}`);
        throw e;
      }
    },
  });
  useEffect(() => {
    installEmbedAutoHeight();
    refreshVideoAdvice();
    // 只在挂载时执行一次；之后由 BlockNote onChange 刷新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // 弹窗打开时错误同时显示在弹窗里；没有弹窗时把顶部错误滚进视野，避免“没反应”。
    if (
      error &&
      !publishOpen &&
      !embedOpen &&
      panel !== "ai" &&
      panel !== "revisions"
    )
      errorRef.current?.scrollIntoView?.({
        block: "nearest",
        behavior: "smooth",
      });
  }, [error, publishOpen, embedOpen, panel]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (leaveGuard.shouldBlockUnload()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      const destination = editorLinkDestination(event, window.location.href);
      if (!destination || (!editClock.current.dirty && !lock.current)) return;
      // 先阻止默认完整导航与其他路由监听，再通过站内弹窗决定是否放行。
      event.preventDefault();
      event.stopImmediatePropagation();
      leaveGuard.request(() => window.location.assign(destination));
    };
    const pageshow = () => leaveGuard.reset();
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pageshow", pageshow);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pageshow", pageshow);
      document.removeEventListener("click", click, true);
    };
  }, [leaveGuard]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  /** 滚动到出问题的块并短暂高亮。 */
  function focusBlock(blockId: string) {
    const element = document.querySelector<HTMLElement>(
      `.bn-block-outer[data-id="${blockId.replace(/[^\w-]/g, "")}"]`,
    );
    if (!element) return;
    element.scrollIntoView?.({ block: "center", behavior: "smooth" });
    element.classList.add("block-attention");
    window.setTimeout(() => element.classList.remove("block-attention"), 3000);
  }
  /**
   * 检查视频块里粘贴的平台链接 / 嵌入代码：YouTube、Bilibili 的嵌入代码自动换成规范链接；
   * X 动态与认不出的嵌入代码给出提示和一键修正（改为嵌入块 / 移除）。
   */
  function refreshVideoAdvice() {
    const advice = adviseVideoBlocks(editor.document);
    for (const item of advice) {
      if (item.action !== "normalize") continue;
      editor.updateBlock(item.blockId, {
        props: { url: item.url },
      } as Parameters<typeof editor.updateBlock>[1]);
      clientLog("info", "editor.video_snippet_normalized", {
        provider: item.provider,
      });
    }
    setVideoAdvice(
      advice.filter(
        (item): item is Exclude<VideoAdvice, { action: "normalize" }> =>
          item.action !== "normalize",
      ),
    );
  }
  function convertVideoToEmbed(
    item: Extract<VideoAdvice, { action: "convert" }>,
  ) {
    editor.replaceBlocks(
      [item.blockId],
      [{ type: "embed", props: { url: item.url } }],
    );
    clientLog("info", "editor.video_converted_to_embed", {
      provider: item.provider,
    });
    markDirty();
    setError("");
    refreshVideoAdvice();
  }
  function removeVideoBlock(item: VideoAdvice) {
    editor.removeBlocks([item.blockId]);
    clientLog("info", "editor.video_block_removed", { reason: item.action });
    markDirty();
    setError("");
    refreshVideoAdvice();
  }
  /** 只有版本冲突才显示“载入最新版本”；链接标识冲突、文章已删除也是 409，但不是版本问题。 */
  function isVersionConflict(e: unknown) {
    return (
      e instanceof ApiError &&
      e.status === 409 &&
      e.code !== "SLUG_CONFLICT" &&
      e.code !== "POST_DELETED"
    );
  }
  /** 统一展示失败：中文原因 + 操作名；ApiError 已由 api() 记录，其余异常在这里记录。 */
  function fail(action: EditorAction, e: unknown) {
    setError(describeEditorError(action, e));
    if (!(e instanceof ApiError)) clientCaught(`editor.${action}_failed`, e);
    const problems = (e as ApiError | undefined)?.details as
      { problems?: { blockId?: unknown }[] } | undefined;
    const blockId = problems?.problems?.[0]?.blockId;
    if (typeof blockId === "string") focusBlock(blockId);
  }
  function changed(setter: (v: string) => void, value: string) {
    setter(value);
    markDirty();
  }
  function fields() {
    return {
      title: title.trim() || "未命名文章",
      blocks: editor.document as unknown as EditorBlock[],
      excerpt,
      category,
      categoryId,
      tags: tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
      coverImage: cover,
      coverSettings: cover ? coverSettings : { ...DEFAULT_COVER_SETTINGS },
      ...(slug.trim() ? { slug: slug.trim() } : {}),
      ...(current ? {} : { visibility: "draft" as const }),
    };
  }
  /** 换图只重置位置与缩放；比例与展示方式沿用。 */
  function chooseCover(url: string) {
    if (url !== cover) setCoverSettings((s) => resetCoverFraming(s));
    setCover(url);
    markDirty();
  }
  function removeCover() {
    setCover("");
    setCoverSettings({ ...DEFAULT_COVER_SETTINGS });
    markDirty();
  }
  async function save(
    keepLock = false,
  ): Promise<{ post: Post; sequence: number } | undefined> {
    const action: EditorAction = keepLock ? "publish" : "save";
    // 已有操作进行中：按钮已禁用并显示进度（仅快捷键会走到这里），不重复提交。
    if (lock.current) return;
    if (!authenticated) {
      setError(
        `${action === "publish" ? "发布" : "保存"}失败：你还没有作者权限，请先登录。`,
      );
      clientLog("warn", "editor.save_blocked", {
        action,
        reason: "unauthenticated",
      });
      return;
    }
    // 保存前用与服务端相同的规则检查链接，直接指出是哪一个块。
    const problems = findContentProblems(editor.document);
    if (problems.length) {
      const first = problems[0];
      setMessage("");
      setError(
        `${action === "publish" ? "发布" : "保存"}失败：${summarizeProblems(problems)}`,
      );
      clientLog("warn", "editor.save_blocked", {
        action,
        reason: first.reason,
        blockType: first.blockType,
        ordinal: first.ordinal,
        count: problems.length,
      });
      if (first.blockId) focusBlock(first.blockId);
      return;
    }
    lock.current = true;
    const base = currentRef.current;
    const sequence = editClock.current.snapshot();
    let succeeded = false;
    setBusy("save");
    setError("");
    setMessage("");
    try {
      const result = await api<{ post: Post }>(
        base ? `/api/posts/${base.id}` : "/api/posts",
        {
          method: base ? "PATCH" : "POST",
          body: JSON.stringify({
            ...fields(),
            ...(base ? { version: base.version } : {}),
          }),
        },
      );
      updateCurrent(result.post);
      const unchanged = editClock.current.acknowledge(sequence);
      // 保存中继续输入时保留新标题、链接和正文，只更新服务器版本号。
      if (unchanged) {
        setTitle(result.post.title);
        setSlug(result.post.slug);
      }
      setDirty(editClock.current.dirty);
      setConflict(false);
      setMessage(
        unchanged
          ? "草稿已保存。已发布的内容保持不变。"
          : "已保存先前快照；你刚输入的内容仍未保存。",
      );
      if (!base && !inline)
        history.replaceState(null, "", `/studio/edit?id=${result.post.id}`);
      succeeded = true;
      return { post: result.post, sequence };
    } catch (e) {
      if (isVersionConflict(e)) setConflict(true);
      fail(action, e);
    } finally {
      if (!keepLock || !succeeded) {
        setBusy("");
        lock.current = false;
      }
    }
  }
  async function publish() {
    if (!publication.allowed) {
      setError(publication.message);
      return;
    }
    const snapshot = await save(true);
    const saved = snapshot?.post;
    if (!saved) return;
    setBusy("publish");
    setError("");
    try {
      const { post: next } = await api<{ post: Post }>(
        `/api/posts/${saved.id}/publish`,
        {
          method: "POST",
          body: JSON.stringify({
            version: saved.version,
            visibility,
            ...(password ? { password } : {}),
          }),
        },
      );
      updateCurrent(next);
      editClock.current.acknowledge(snapshot!.sequence);
      setDirty(editClock.current.dirty);
      setPublishOpen(false);
      onPublished?.(next);
      setMessage(
        editClock.current.dirty
          ? "已发布刚才保存的版本；你之后输入的内容仍未保存。"
          : "已发布。读者现在可以看到这次更新。",
      );
    } catch (e) {
      if (isVersionConflict(e)) setConflict(true);
      fail("publish", e);
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function reload() {
    if (
      lock.current ||
      !current ||
      !confirm(
        "加载服务器最新版本将替换本页未保存修改。建议先导出 Markdown 备份，确定继续？",
      )
    )
      return;
    lock.current = true;
    setBusy("reload");
    const sequence = editClock.current.snapshot();
    try {
      const { post: p } = await api<{ post: Post }>(`/api/posts/${current.id}`);
      const applied = applyEditorReplacement(
        editClock.current,
        sequence,
        () => {
          editor.replaceBlocks(
            editor.document,
            p.blocks as unknown as PartialBlock<typeof schema.blockSchema>[],
          );
          updateCurrent(p);
          setTitle(p.title);
          setExcerpt(p.excerpt);
          setTags(p.tags.join(", "));
          setCategory(p.category);
          setCategoryId(p.categoryId);
          setCover(p.coverImage);
          setCoverSettings(normalizeCoverSettings(p.coverSettings));
          setSlug(p.slug);
          markClean();
          setConflict(false);
          setError("");
          setMessage("已载入服务器最新版本。");
        },
      );
      if (!applied)
        setError("载入期间你又修改了文章，已保留本地输入；请备份后重新载入。");
    } catch (e) {
      fail("reload", e);
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function exportMarkdown() {
    const md = editor.blocksToMarkdownLossy(editor.document);
    downloadText(
      `${slug || "untitled"}.md`,
      `# ${title || "未命名文章"}\n\n${md}`,
    );
  }
  async function importMarkdown(file: File | undefined) {
    if (!file || lock.current) return;
    // 上限来自设置页“上传与媒体 → Markdown 导入上限”（硬上限与服务端正文字符上限一致）。
    const importMax = limits.upload.markdownImportMaxKB * KiB;
    if (file.size > importMax) {
      clientLog("warn", "editor.import_rejected", {
        reason: "too_large",
        size: file.size,
      });
      setError(
        `Markdown 文件请小于 ${formatBytes(importMax)}（可在“设置 → 上传与媒体”调整）。`,
      );
      if (importInput.current) importInput.current.value = "";
      return;
    }
    if (
      hasDocumentContent(editor.document) &&
      !confirm("导入会替换当前正文。确定继续？")
    ) {
      if (importInput.current) importInput.current.value = "";
      return;
    }
    lock.current = true;
    setBusy("import");
    const sequence = editClock.current.snapshot();
    try {
      const text = await file.text();
      const parsed = editor.tryParseMarkdownToBlocks(text);
      // 转换后的正文 JSON 会比 Markdown 大；超过服务端正文上限时现在就提示，而不是保存时才失败。
      if (JSON.stringify(parsed).length > MAX_DOCUMENT_CHARS) {
        clientLog("warn", "editor.import_rejected", {
          reason: "content_too_large",
          size: file.size,
        });
        setError(
          "这份 Markdown 转换后超过了单篇文章的正文上限，请拆成几篇再导入。",
        );
        return;
      }
      const applied = applyEditorReplacement(
        editClock.current,
        sequence,
        () => {
          editor.replaceBlocks(editor.document, parsed);
          if (!title) {
            const match = text.match(/^#\s+(.+)$/m);
            if (match) setTitle(match[1]);
          }
          markDirty();
          setMessage("已导入 Markdown，请检查排版后保存。");
        },
      );
      if (!applied)
        setError("读取文件期间你又修改了文章，已取消导入并保留本地输入。");
    } catch (e) {
      fail("import", e);
    } finally {
      lock.current = false;
      setBusy("");
      if (importInput.current) importInput.current.value = "";
    }
  }
  function closeAI() {
    aiSession.current.invalidate();
    setPanel(null);
  }
  function openAI(action: AIAction = "polish") {
    aiSession.current.invalidate();
    const selected = editor.getSelectedText();
    setSelection(selected || editor.blocksToMarkdownLossy(editor.document));
    setAiAction(action);
    setAiText("");
    setPanel("ai");
  }
  // 与服务端一致：显式选择优先，其次 Prompt 绑定；默认由服务端选择已配置项。
  const effectiveProviderId =
    provider || settings.prompts.find((p) => p.id === promptId)?.providerId;
  const selectedTextConfigured =
    !effectiveProviderId ||
    settings.providers.some(
      (p) => p.id === effectiveProviderId && p.textConfigured === true,
    );
  async function runAI() {
    if (
      lock.current ||
      !aiConfigured ||
      !selectedTextConfigured ||
      !selection.trim()
    )
      return;
    lock.current = true;
    const session = aiSession.current.snapshot();
    setAiText("");
    setBusy("ai");
    setError("");
    try {
      const data = await api<{ text: string }>("/api/ai", {
        method: "POST",
        body: JSON.stringify({
          action: aiAction,
          selection,
          ...(current ? { postId: current.id } : {}),
          ...(provider ? { providerId: provider } : {}),
          ...(promptId ? { promptId } : {}),
          ...(aiAction === "translate" ? { language: "English" } : {}),
        }),
      });
      if (aiSession.current.isCurrent(session)) setAiText(data.text);
    } catch (e) {
      if (aiSession.current.isCurrent(session)) fail("ai", e);
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  function applyAI() {
    if (lock.current || !aiText.trim()) return;
    if (aiAction === "title") setTitle(aiText.trim());
    else if (aiAction === "excerpt") setExcerpt(aiText.trim());
    else if (aiAction === "tags")
      setTags(aiText.replace(/^\[|\]$/g, "").replaceAll('"', ""));
    else if (aiAction === "slug") setSlug(aiText.trim().toLowerCase());
    else {
      editor.focus();
      editor.insertInlineContent(aiText);
    }
    markDirty();
    setMessage("已应用 AI 建议，请检查后保存。");
    setPanel(null);
  }
  function insertMedia(media: Media) {
    const type = media.mime.startsWith("image/")
      ? "image"
      : media.mime.startsWith("video/")
        ? "video"
        : media.mime.startsWith("audio/")
          ? "audio"
          : "file";
    editor.insertBlocks(
      [{ type, props: { url: media.url, name: media.name } }],
      editor.getTextCursorPosition().block,
      "after",
    );
    markDirty();
    setPanel(null);
  }
  async function loadRevisions() {
    setPanel("revisions");
    if (!current) return;
    try {
      const r = await api<{ revisions: Revision[] }>(
        `/api/posts/${current.id}/revisions`,
      );
      setRevisions(r.revisions);
    } catch (e) {
      fail("revisions", e);
    }
  }
  async function restore(version: number) {
    if (
      lock.current ||
      !current ||
      !confirm(
        "将这个历史版本恢复为当前草稿？现有内容仍保留在版本历史中，不会自动发布。",
      )
    )
      return;
    lock.current = true;
    const sequence = editClock.current.snapshot();
    setBusy("restore");
    try {
      const { post: p } = await api<{ post: Post }>(
        `/api/posts/${current.id}/revisions/${version}/restore`,
        { method: "POST", body: JSON.stringify({ version: current.version }) },
      );
      // 服务端已恢复历史版本；即使本地又输入，也必须保留新的 CAS 版本号。
      updateCurrent(p);
      const applied = applyEditorReplacement(
        editClock.current,
        sequence,
        () => {
          editor.replaceBlocks(
            editor.document,
            p.blocks as unknown as PartialBlock<typeof schema.blockSchema>[],
          );
          updateCurrent(p);
          setTitle(p.title);
          setExcerpt(p.excerpt);
          setCategory(p.category);
          setCategoryId(p.categoryId);
          setTags(p.tags.join(", "));
          setCover(p.coverImage);
          setCoverSettings(normalizeCoverSettings(p.coverSettings));
          setSlug(p.slug);
          markClean();
          setPanel(null);
          setMessage("历史版本已恢复到草稿，尚未发布。");
        },
      );
      if (!applied)
        setMessage(
          "服务器草稿已恢复历史版本；你在等待期间的新输入已保留，仍未保存。",
        );
    } catch (e) {
      fail("restore", e);
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  const modalError = error ? <Notice kind="error">{error}</Notice> : null;
  const adviceList = videoAdvice.length ? (
    <Notice>
      {videoAdvice.map((item) => (
        <span className="editor-video-advice" key={item.blockId}>
          <span>{item.message}</span>
          {item.action === "convert" ? (
            <button
              className="button small"
              disabled={!!busy}
              onClick={() => convertVideoToEmbed(item)}
            >
              改为嵌入块
            </button>
          ) : (
            <button
              className="button small"
              disabled={!!busy}
              onClick={() => removeVideoBlock(item)}
            >
              移除这个视频块
            </button>
          )}
          <button
            className="text-button"
            onClick={() => focusBlock(item.blockId)}
          >
            定位
          </button>
        </span>
      ))}
    </Notice>
  ) : null;
  return (
    <div className={`editor-shell ${inline ? "inline-editor" : ""}`}>
      {leaveOpen && (
        <Modal title="还有未保存的修改" onClose={() => leaveGuard.cancel()}>
          <p>
            返回会丢弃本次尚未保存的修改，已保存的草稿不会被删除。你可以继续编辑并保存后再返回。
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => leaveGuard.cancel()}>
              继续编辑
            </button>
            <button
              className="button danger"
              disabled={!!busy}
              onClick={() => leaveGuard.confirm()}
            >
              丢弃修改并返回
            </button>
          </div>
        </Modal>
      )}
      <header className="editor-toolbar">
        <div className="editor-toolbar-start">
          {onClose ? (
            <button
              className="icon-button"
              title="返回阅读"
              disabled={!!busy}
              onClick={() => leaveGuard.request(onClose)}
            >
              <ArrowLeft size={18} />
            </button>
          ) : (
            <a className="icon-button" href="/studio" title="返回写作台">
              <ArrowLeft size={18} />
            </a>
          )}
          <span className="editor-label">
            {inline ? "原地编辑" : "写作模式"}
          </span>
          <span className={`save-status ${dirty ? "unsaved" : ""}`}>
            <span className="status-dot" />
            {busy === "save"
              ? "保存中…"
              : dirty
                ? "有未保存修改"
                : current
                  ? "草稿已保存"
                  : "新的开始"}
          </span>
        </div>
        <div className="editor-toolbar-actions">
          <button
            className="icon-button"
            title="文章设置"
            onClick={() => setPanel(panel === "meta" ? null : "meta")}
          >
            <Settings2 size={18} />
          </button>
          <button
            className="button small"
            disabled={!!busy || !authenticated}
            onClick={() => void save()}
          >
            <Save size={15} />
            保存草稿
          </button>
          <button
            className="button small primary"
            disabled={!!busy || !authenticated}
            onClick={() => setPublishOpen(true)}
          >
            发布 <ArrowUpRight size={15} />
          </button>
        </div>
      </header>
      {!authenticated && (
        <Notice>
          你还没有作者权限。正文可预览，保存与发布需要可信作者身份。
        </Notice>
      )}
      <div ref={errorRef}>{modalError}</div>
      {adviceList}
      {message && (
        <Notice kind="success">
          {message}
          {current?.publishedAt && (
            <a href={`/p/${current.slug}?published=1`}>查看已发布文章 ↗</a>
          )}
        </Notice>
      )}
      {conflict && (
        <Notice kind="error">
          <strong>检测到版本冲突。</strong>
          另一个窗口已保存了更新，本页内容仍在。请先备份，再载入最新版本进行合并。
          <div className="button-group">
            <button className="button small" onClick={exportMarkdown}>
              导出本页 Markdown
            </button>
            <button className="button small" onClick={reload}>
              载入最新版本
            </button>
          </div>
        </Notice>
      )}
      <div className="editor-workspace">
        <div className="editor-document">
          {cover ? (
            <div className="editor-cover">
              <CoverFrame src={cover} settings={coverSettings} alt="文章封面" />
              <div className="editor-cover-actions">
                <button
                  className="button small"
                  disabled={!!busy}
                  onClick={() => setCoverDraft(coverSettings)}
                >
                  <SlidersHorizontal size={14} />
                  调整封面
                </button>
                <button
                  className="button small"
                  disabled={!!busy}
                  onClick={() => setPanel("media")}
                >
                  <ImagePlus size={14} />
                  更换封面
                </button>
                <button
                  className="button small"
                  disabled={!!busy}
                  onClick={removeCover}
                >
                  移除封面
                </button>
              </div>
            </div>
          ) : (
            <button className="add-cover" onClick={() => setPanel("media")}>
              <ImagePlus size={16} />
              添加封面
            </button>
          )}
          <div className="editor-title-wrap">
            <input
              className="editor-title"
              aria-label="文章标题"
              placeholder="给想法一个标题…"
              value={title}
              onChange={(e) => changed(setTitle, e.target.value)}
            />
            <TypeSelector
              initialTypes={settings.articleTypes}
              value={categoryId}
              legacyName={category}
              disabled={!authenticated || !!busy}
              onChange={(id, name) => {
                setCategoryId(id);
                setCategory(name);
                markDirty();
              }}
            />
            <div className="editor-byline">
              <span>{category || "未分类"}</span>
              <span>·</span>
              <span>
                {date(current?.updatedAt || new Date().toISOString())}
              </span>
              <span>·</span>
              <span>自己的文字，自己的空间</span>
            </div>
          </div>
          <div className="writing-shortcuts">
            <button onClick={() => openAI()}>
              <Sparkles size={14} />
              AI 助手
            </button>
            <button onClick={() => setPanel("media")}>
              <ImagePlus size={14} />
              媒体
            </button>
            <button onClick={() => setEmbedOpen(true)}>
              <Link size={14} />
              嵌入
            </button>
            <button onClick={() => importInput.current?.click()}>
              <FileUp size={14} />
              导入
            </button>
            <button onClick={exportMarkdown}>
              <Download size={14} />
              导出
            </button>
            <ObsidianSaveButton
              getSnapshot={() => {
                // 新稿在当前编辑会话内保持同一身份，不为本地导出提前写入服务器。
                localArticleId.current ??= crypto.randomUUID();
                const blocks = structuredClone(editor.document);
                return {
                  articleId: currentRef.current?.id ?? localArticleId.current,
                  title: title || "未命名文章",
                  markdown: editor.blocksToMarkdownLossy(blocks),
                  blocks: blocks as EditorBlock[],
                  ...(cover ? { coverUrl: cover } : {}),
                };
              }}
            />
            <button onClick={loadRevisions}>
              <History size={14} />
              历史
            </button>
            <input
              type="file"
              accept=".md,.markdown,text/markdown,text/plain"
              hidden
              ref={importInput}
              onChange={(e) => void importMarkdown(e.target.files?.[0])}
            />
          </div>
          <BlockNoteView
            editor={editor}
            theme={resolvedMode}
            editable={authenticated && !busy}
            onChange={() => {
              markDirty();
              setMessage("");
              refreshVideoAdvice();
            }}
            formattingToolbar={false}
          >
            <FormattingToolbarController
              formattingToolbar={() => (
                <div className="extended-formatting-toolbar">
                  <FormattingToolbar />
                  <button
                    className="selection-ai"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => openAI()}
                  >
                    <Sparkles size={15} />
                    AI
                  </button>
                </div>
              )}
            />
          </BlockNoteView>
          <div className="editor-bottom-hint">
            输入 <kbd>/</kbd> 添加内容块 · 选中文字进行格式化或 AI 改写 ·{" "}
            <kbd>⌘ / Ctrl S</kbd> 保存
          </div>
        </div>
        {panel === "meta" && (
          <aside className="editor-inspector">
            <div className="inspector-heading">
              <h3>文章设置</h3>
              <button
                className="icon-button"
                onClick={() => setPanel(null)}
                aria-label="关闭文章设置"
              >
                <X size={16} />
              </button>
            </div>
            <label>
              链接标识
              <input
                value={slug}
                onChange={(e) => changed(setSlug, e.target.value)}
                placeholder="my-first-note"
              />
              <small>小写字母、数字与短横线。留空时自动生成。</small>
            </label>
            <label>
              摘要
              <textarea
                rows={4}
                value={excerpt}
                onChange={(e) => changed(setExcerpt, e.target.value)}
                placeholder="用几句话，邀请读者走进文章。"
              />
            </label>
            <button className="text-button" onClick={() => openAI("excerpt")}>
              <Sparkles size={13} />
              AI 生成摘要
            </button>
            <label>
              标签
              <input
                value={tags}
                onChange={(e) => changed(setTags, e.target.value)}
                placeholder="设计, 思考, 日常"
              />
              <small>用逗号分隔</small>
            </label>
            <div className="inspector-note">
              <strong>草稿和发布，分开管理。</strong>
              <p>保存只更新工作副本。按下「发布」后，读者才会看到新版本。</p>
            </div>
            {current?.publishedAt && (
              <button
                className="button danger-text"
                disabled={!!busy || !authenticated}
                onClick={async () => {
                  if (lock.current || !authenticated) return;
                  if (confirm("确定撤下已发布版本？草稿会保留。")) {
                    lock.current = true;
                    setBusy("unpublish");
                    try {
                      const r = await api<{ post: Post }>(
                        `/api/posts/${current.id}/unpublish`,
                        {
                          method: "POST",
                          body: JSON.stringify({ version: current.version }),
                        },
                      );
                      updateCurrent(r.post);
                      onPublished?.(r.post);
                      setMessage("已撤下公开版本，草稿仍保留。");
                    } catch (e) {
                      if (isVersionConflict(e)) setConflict(true);
                      fail("unpublish", e);
                    } finally {
                      lock.current = false;
                      setBusy("");
                    }
                  }
                }}
              >
                撤下已发布版本
              </button>
            )}
          </aside>
        )}
      </div>
      {panel === "media" && (
        <Modal title="选一份合适的素材" wide onClose={() => setPanel(null)}>
          <MediaLibrary
            config={limits}
            postId={current?.id}
            imageConfigured={imageConfigured}
            providers={settings.providers}
            onInsert={insertMedia}
            onCover={(m) => {
              chooseCover(m.url);
              setPanel(null);
            }}
          />
        </Modal>
      )}
      {panel === "ai" && (
        <Modal title="AI 写作搭档" onClose={closeAI}>
          {modalError}
          {!aiConfigured && (
            <Notice>
              尚未配置 AI 服务端密钥。到
              <a href="/studio/settings#models">模型设置</a>
              查看配置说明；这里不会生成模拟内容。
            </Notice>
          )}
          <div className="form-grid">
            <label>
              想怎么处理
              <select
                value={aiAction}
                disabled={!!busy}
                onChange={(e) => {
                  aiSession.current.invalidate();
                  setAiText("");
                  setAiAction(e.target.value as AIAction);
                  setPromptId("");
                }}
              >
                {Object.entries(actionNames).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              模型
              <select
                value={provider}
                disabled={!!busy}
                onChange={(e) => {
                  setAiText("");
                  setProvider(e.target.value);
                }}
              >
                <option value="">第一个已配置的文本服务商</option>
                {settings.providers.map((p) => (
                  <option value={p.id} key={p.id} disabled={!p.textConfigured}>
                    {p.name} · {p.model}
                    {p.textConfigured
                      ? "（配置已就绪，未验证联调）"
                      : "（文本未配置）"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            提示词
            <select
              value={promptId}
              disabled={!!busy}
              onChange={(e) => {
                setAiText("");
                setPromptId(e.target.value);
              }}
            >
              <option value="">内置提示词</option>
              {settings.prompts
                .filter((p) => p.action === aiAction)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            处理的文字
            <textarea
              rows={4}
              value={selection}
              disabled={!!busy}
              onChange={(e) => {
                setAiText("");
                setSelection(e.target.value);
              }}
            />
          </label>
          {aiText && (
            <label>
              AI 建议 · 应用前请检查
              <textarea
                rows={6}
                value={aiText}
                onChange={(e) => setAiText(e.target.value)}
              />
            </label>
          )}
          {!selectedTextConfigured && (
            <Notice>
              当前选择或提示词绑定的文本服务商尚未配置，请选择已配置的服务商。
            </Notice>
          )}
          <div className="modal-actions">
            <button
              className="button"
              disabled={
                !!busy || !selection || !aiConfigured || !selectedTextConfigured
              }
              onClick={runAI}
            >
              {busy === "ai" ? (
                <Busy text="思考中…" />
              ) : (
                <>
                  <Sparkles size={15} />
                  {aiText ? "重新生成" : "生成建议"}
                </>
              )}
            </button>
            {aiText && (
              <button
                className="button primary"
                disabled={!!busy || !aiText.trim()}
                onClick={applyAI}
              >
                <Check size={15} />
                应用到
                {["title", "excerpt", "tags", "slug"].includes(aiAction)
                  ? "文章设置"
                  : "当前选区"}
              </button>
            )}
          </div>
        </Modal>
      )}
      {panel === "revisions" && (
        <Modal title="每一步，都有迹可循" onClose={() => setPanel(null)}>
          {modalError}
          {!current ? (
            <p>保存文章后即可查看版本历史。</p>
          ) : revisions.length ? (
            <div className="revision-list">
              {revisions.map((r) => (
                <div key={r.version}>
                  <span className="revision-dot" />
                  <div>
                    <strong>
                      版本 {r.version} · {r.title}
                    </strong>
                    <small>
                      {date(r.createdAt)} · {r.reason}
                    </small>
                  </div>
                  <button
                    className="button small"
                    disabled={!!busy}
                    onClick={() => restore(r.version)}
                  >
                    恢复草稿
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p>尚无历史版本。</p>
          )}
        </Modal>
      )}
      {publishOpen && (
        <Modal
          title={
            current?.publishedAt ? "把这次更新，分享出去" : "让你的文字被看见"
          }
          onClose={() => {
            if (!lock.current) setPublishOpen(false);
          }}
        >
          <p className="muted">将先保存草稿，再发布当前完整版本。</p>
          {/* 保存或发布失败时原因显示在弹窗里：弹窗遮住了编辑器顶部的提示栏。 */}
          {modalError}
          {adviceList}
          <label>
            谁可以阅读
            <select
              value={visibility}
              disabled={!!busy}
              onChange={(e) =>
                setVisibility(e.target.value as typeof visibility)
              }
            >
              <option value="public">公开 · 显示在首页与 RSS</option>
              <option value="unlisted">不公开列出 · 仅通过链接访问</option>
              <option value="password" disabled={!passwordConfigured}>
                密码保护 · 输入密码后访问
              </option>
            </select>
          </label>
          {!passwordConfigured && (
            <Notice>
              {publicationAvailability("password", false).message}{" "}
              公开与链接发布不受影响。
            </Notice>
          )}
          {visibility === "password" && (
            <label>
              访问密码
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                disabled={!!busy}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 8 位；已设置时可留空保持"
              />
            </label>
          )}
          <fieldset className="publish-cover">
            <legend>封面</legend>
            {cover ? (
              <>
                <CoverAdjuster
                  src={cover}
                  value={coverSettings}
                  disabled={!!busy}
                  onChange={(next) => {
                    setCoverSettings(next);
                    markDirty();
                  }}
                />
                <div className="button-group">
                  <button
                    className="button small"
                    disabled={!!busy}
                    onClick={() => setCoverPickerOpen(true)}
                  >
                    <ImagePlus size={14} />
                    更换图片
                  </button>
                  <button
                    className="button small"
                    disabled={!!busy}
                    onClick={removeCover}
                  >
                    移除封面
                  </button>
                </div>
              </>
            ) : (
              <div className="publish-cover-empty">
                <p className="muted">
                  还没有封面。选一张图片，再选择比例与展示方式。
                </p>
                <button
                  className="button small"
                  disabled={!!busy}
                  onClick={() => setCoverPickerOpen(true)}
                >
                  <ImagePlus size={14} />
                  选择封面图片
                </button>
              </div>
            )}
          </fieldset>
          <div className="modal-actions">
            <button
              className="button"
              disabled={!!busy}
              onClick={() => setPublishOpen(false)}
            >
              再检查一下
            </button>
            <button
              className="button primary"
              disabled={!!busy || !publication.allowed}
              onClick={publish}
            >
              {busy ? (
                <Busy text="正在发布…" />
              ) : (
                <>
                  <Globe2 size={16} />
                  确认发布
                </>
              )}
            </button>
          </div>
        </Modal>
      )}
      {coverPickerOpen && (
        <Modal
          title="选择封面图片"
          wide
          onClose={() => setCoverPickerOpen(false)}
        >
          <MediaLibrary
            config={limits}
            postId={current?.id}
            imageConfigured={imageConfigured}
            providers={settings.providers}
            onCover={(m) => {
              chooseCover(m.url);
              setCoverPickerOpen(false);
            }}
          />
        </Modal>
      )}
      {coverDraft && cover && (
        <Modal title="调整封面 · 保留原图" onClose={() => setCoverDraft(null)}>
          <CoverAdjuster
            src={cover}
            value={coverDraft}
            onChange={setCoverDraft}
          />
          <div className="modal-actions">
            <button className="button" onClick={() => setCoverDraft(null)}>
              取消
            </button>
            <button
              className="button primary"
              onClick={() => {
                setCoverSettings(coverDraft);
                setCoverDraft(null);
                markDirty();
              }}
            >
              应用
            </button>
          </div>
        </Modal>
      )}
      {embedOpen && (
        <Modal title="嵌入来自外面的灵感" onClose={() => setEmbedOpen(false)}>
          <p className="muted">
            支持 {supportedEmbedLabel()}
            。可以粘贴链接，也可以直接粘贴平台的官方嵌入代码（只取出其中的链接，代码本身不会被保存或执行）。短链接（如
            b23.tv）请先在浏览器打开再复制完整地址。
          </p>
          <label>
            内容链接或嵌入代码
            <textarea
              rows={3}
              value={embedValue}
              onChange={(e) => setEmbedValue(e.target.value)}
              placeholder="https://www.bilibili.com/video/BV…、https://x.com/用户名/status/…，或官方嵌入代码"
            />
          </label>
          {embedCheck.ok && embedCheck.fromSnippet && (
            <p className="muted" role="status">
              已从嵌入代码中识别出 {embedCheck.match.provider.name} 链接：
              {embedInsertUrl}
            </p>
          )}
          {embedCheck.ok && <SafeEmbed url={embedInsertUrl} silent />}
          {embedDisabled && (
            <p className="muted" role="status">
              {embedCheck.ok && embedCheck.match.provider.name}
              嵌入已在“设置 → 嵌入与阅读”中关闭，不能插入。
            </p>
          )}
          {embedValue.trim() && !embedCheck.ok && (
            <p className="muted" role="status">
              {embedRejectMessage(embedCheck.reason)}
            </p>
          )}
          <div className="modal-actions">
            <button className="button" onClick={() => setEmbedOpen(false)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={!embedCheck.ok || embedDisabled}
              onClick={() => {
                if (!embedCheck.ok) {
                  reportEmbedRejection("editor", embedCheck);
                  return;
                }
                if (embedDisabled) {
                  clientLog("info", "editor.embed_disabled", {
                    provider: embedCheck.match.provider.id,
                  });
                  return;
                }
                editor.insertBlocks(
                  [{ type: "embed", props: { url: embedInsertUrl } }],
                  editor.getTextCursorPosition().block,
                  "after",
                );
                if (embedCheck.fromSnippet)
                  clientLog("info", "editor.embed_snippet_parsed", {
                    provider: embedCheck.match.provider.id,
                  });
                markDirty();
                setEmbedOpen(false);
                setEmbedValue("");
              }}
            >
              插入内容
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
