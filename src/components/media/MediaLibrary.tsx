import { MediaOperation } from "./media-operation";
import { useStudioPane } from "../../modules/studio-navigation/pane";
import { useNavigationReady } from "../../modules/navigation-performance/use-navigation-ready";
import { CropRenderGuard, cropGeometry } from "./crop-state";
import { mediaUploadProblem, type Provider } from "../../shared/contracts";
import {
  DEFAULT_CONFIG,
  TEXT_LIMITS,
  enabledMediaMimes,
  type RuntimeConfig,
} from "../../modules/config";
import { clientLog } from "../../modules/log/client";
import { useEffect, useRef, useState } from "react";
import {
  Upload,
  ImagePlus,
  Download,
  Crop,
  Check,
  File,
  Sparkles,
} from "lucide-react";
import {
  api,
  type Media,
  Notice,
  Busy,
  Empty,
  SearchBox,
  Modal,
  date,
} from "../shared/ui";
function CropImage({
  media,
  onClose,
  onSaved,
  postId,
  options = DEFAULT_CONFIG.media,
}: {
  media: Media;
  onClose: () => void;
  onSaved: (media: Media) => void;
  postId?: string;
  options?: RuntimeConfig["media"];
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState("1.7778");
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef(new MediaOperation());
  const guard = useRef(new CropRenderGuard());
  const [ready, setReady] = useState(false);
  const cropKey = JSON.stringify([media.url, ratio, zoom, x, y]);
  useEffect(() => {
    guard.current.begin(cropKey);
    setReady(false);
    setError("");
    let active = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!active) return;
      try {
        const c = canvas.current;
        if (!c || img.naturalWidth <= 0 || img.naturalHeight <= 0)
          throw new Error("图片没有有效的解码尺寸。");
        const geometry = cropGeometry(
          img.naturalWidth,
          img.naturalHeight,
          Number(ratio),
          zoom,
          x,
          y,
          options.cropOutputWidth,
        );
        c.width = geometry.width;
        c.height = geometry.height;
        const context = c.getContext("2d");
        if (!context) throw new Error("此浏览器不支持图片裁剪。");
        context.drawImage(
          img,
          geometry.sx,
          geometry.sy,
          geometry.sw,
          geometry.sh,
          0,
          0,
          c.width,
          c.height,
        );
        setReady(
          guard.current.drawn(cropKey, img.naturalWidth, img.naturalHeight),
        );
      } catch (error) {
        guard.current.failed(cropKey);
        setReady(false);
        setError((error as Error).message);
      }
    };
    img.onerror = () => {
      if (!active) return;
      guard.current.failed(cropKey);
      setReady(false);
      setError("图片无法读取，不能裁剪。外部图片可能禁止跨域访问。");
    };
    img.src = media.url;
    return () => {
      active = false;
      img.onload = null;
      img.onerror = null;
    };
  }, [cropKey, media.url, ratio, zoom, x, y, options.cropOutputWidth]);
  async function save() {
    if (!operation.current.begin()) return;
    setBusy(true);
    setError("");
    try {
      // 即使有人绕过禁用按钮，保存函数仍重复验证当前绘制状态。
      guard.current.assertReady(cropKey);
      const target = canvas.current;
      if (!target) throw new Error("裁剪画布已关闭。");
      const blob = await new Promise<Blob>((resolve, reject) => {
        try {
          target.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("无法导出图片"))),
            "image/jpeg",
            options.cropJpegQuality / 100,
          );
        } catch (e) {
          reject(e);
        }
      });
      guard.current.assertReady(cropKey);
      const form = new FormData();
      form.append(
        "file",
        blob,
        `crop-${media.name.replace(/\.[^.]+$/, "")}.jpg`,
      );
      if (postId) form.append("postId", postId);
      const result = await api<{ media: Media }>("/api/media", {
        method: "POST",
        body: form,
      });
      onSaved(result.media);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      operation.current.end();
      setBusy(false);
    }
  }
  return (
    <Modal
      title="裁剪图片 · 保留原图"
      onClose={() => {
        if (!operation.current.busy) onClose();
      }}
    >
      <div className="crop-preview">
        <canvas ref={canvas} />
      </div>
      <div className="form-grid">
        <label>
          比例
          <select
            value={ratio}
            disabled={busy}
            onChange={(e) => setRatio(e.target.value)}
          >
            <option value="1.7778">横向 16 : 9</option>
            <option value="1">方形 1 : 1</option>
            <option value="0.75">纵向 3 : 4</option>
            <option value="0">原始比例</option>
          </select>
        </label>
        <label>
          缩放
          <input
            type="range"
            min="1"
            max="3"
            step="0.05"
            value={zoom}
            disabled={busy}
            onChange={(e) => setZoom(+e.target.value)}
          />
        </label>
        <label>
          水平位置
          <input
            type="range"
            min="0"
            max="100"
            value={x}
            disabled={busy}
            onChange={(e) => setX(+e.target.value)}
          />
        </label>
        <label>
          垂直位置
          <input
            type="range"
            min="0"
            max="100"
            value={y}
            disabled={busy}
            onChange={(e) => setY(+e.target.value)}
          />
        </label>
      </div>
      {!ready && !error && <Notice>正在载入并绘制图片…</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="modal-actions">
        <button className="button" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={busy || !ready || !guard.current.canExport(cropKey)}
          onClick={save}
        >
          {busy ? (
            <Busy />
          ) : (
            <>
              <Check size={15} />
              保存为新图片
            </>
          )}
        </button>
      </div>
    </Modal>
  );
}
export default function MediaLibrary({
  onInsert,
  onCover,
  postId,
  imageConfigured = false,
  providers = [],
  initialMedia,
  initialError = "",
  config = DEFAULT_CONFIG,
}: {
  /** 设置页配置：上传上限/类型、列表条数、裁剪参数。 */
  config?: RuntimeConfig;
  onInsert?: (media: Media) => void;
  onCover?: (media: Media) => void;
  postId?: string;
  imageConfigured?: boolean;
  providers?: Provider[];
  initialMedia?: Media[];
  initialError?: string;
}) {
  const { active } = useStudioPane();
  useEffect(() => {
    if (!active) {
      setGenerate(false);
      setCrop(null);
    }
  }, [active]);
  const [media, setMedia] = useState<Media[]>(initialMedia ?? []);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(
    initialMedia === undefined && !initialError,
  );
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const operation = useRef(new MediaOperation());
  const [prompt, setPrompt] = useState("");
  const [providerId, setProviderId] = useState("");
  const [generate, setGenerate] = useState(false);
  const [crop, setCrop] = useState<Media | null>(null);
  useNavigationReady("/studio/media", !loading, !!error);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (initialMedia !== undefined || initialError) return;
    api<{ media: Media[] }>("/api/media")
      .then((r) =>
        setMedia((current) => {
          const known = new Set(current.map((item) => item.id));
          return [...current, ...r.media.filter((item) => !known.has(item.id))];
        }),
      )
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [initialMedia, initialError]);
  async function upload(files: FileList | null) {
    if (!files?.length || !operation.current.begin()) return;
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        // 与服务端同一个检查函数（src/modules/config uploadProblem），上传前就给出中文原因。
        const problem = mediaUploadProblem(file, config.upload);
        if (problem) {
          clientLog("warn", "media.upload_rejected", {
            reason: problem.reason,
            mime: file.type || "unknown",
            size: file.size,
          });
          throw new Error(problem.message);
        }
        const form = new FormData();
        form.append("file", file);
        if (postId) form.append("postId", postId);
        const r = await api<{ media: Media }>("/api/media", {
          method: "POST",
          body: form,
        });
        setMedia((prev) => [r.media, ...prev]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      operation.current.end();
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function generateImage() {
    if (
      !imageConfigured ||
      !prompt.trim() ||
      (providerId &&
        !providers.find((p) => p.id === providerId)?.imageConfigured) ||
      !operation.current.begin()
    )
      return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ media: Media }>("/api/images/generate", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          ...(postId ? { postId } : {}),
          ...(providerId ? { providerId } : {}),
        }),
      });
      setMedia((prev) => [r.media, ...prev]);
      setGenerate(false);
      setPrompt("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      operation.current.end();
      setBusy(false);
    }
  }
  const filtered = media
    .filter(
      (m) =>
        (filter !== "generated" || m.source === "generated") &&
        (filter !== "image" || m.mime.startsWith("image/")) &&
        `${m.name} ${m.prompt || ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .slice(0, config.media.listLimit);
  return (
    <>
      <div className="media-tools">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="搜索文件名或生成提示词…"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="媒体类型"
        >
          <option value="all">全部文件</option>
          <option value="image">所有图片</option>
          <option value="generated">AI 生成历史</option>
        </select>
        <div className="button-group">
          <button
            className="button"
            disabled={busy}
            onClick={() => {
              if (!operation.current.busy) setGenerate(true);
            }}
          >
            <Sparkles size={16} />
            生成图片
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? (
              <Busy text="上传中" />
            ) : (
              <>
                <Upload size={16} />
                上传文件
              </>
            )}
          </button>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => upload(e.target.files)}
          accept={enabledMediaMimes(config.upload).join(",")}
        />
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {loading ? (
        <div className="loading-panel">
          <Busy text="读取媒体库…" />
        </div>
      ) : filtered.length ? (
        <div className="media-grid">
          {filtered.map((m) => (
            <article className="media-card" key={m.id}>
              <div className="media-preview">
                {m.mime.startsWith("image/") ? (
                  <img src={m.url} alt={m.name} loading="lazy" />
                ) : (
                  <File size={34} />
                )}
                <span className="media-kind">
                  {m.source === "generated" ? "AI 图片" : m.mime.split("/")[0]}
                </span>
              </div>
              <div className="media-info">
                <strong title={m.name}>{m.name}</strong>
                <p>
                  {(m.size / 1024).toFixed(0)} KB · {date(m.createdAt)}
                </p>
                {m.prompt && <p className="media-prompt">{m.prompt}</p>}
                <div className="media-actions">
                  {onInsert && (
                    <button
                      className="button small"
                      onClick={() => onInsert(m)}
                    >
                      <ImagePlus size={14} />
                      插入
                    </button>
                  )}
                  {onCover && m.mime.startsWith("image/") && (
                    <button className="button small" onClick={() => onCover(m)}>
                      设为封面
                    </button>
                  )}
                  {m.mime.startsWith("image/") && (
                    <button
                      className="icon-button"
                      title="裁剪"
                      disabled={busy}
                      onClick={() => setCrop(m)}
                    >
                      <Crop size={16} />
                    </button>
                  )}
                  <a
                    className="icon-button"
                    href={m.url}
                    download={m.name}
                    title="下载"
                  >
                    <Download size={16} />
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="给文字，添一点画面"
          action={
            <button className="button" onClick={() => input.current?.click()}>
              <Upload size={16} />
              上传第一份素材
            </button>
          }
        >
          支持图片、音频、视频与附件。原图会保留，裁剪结果另存为新文件。
        </Empty>
      )}
      <p className="form-hint">
        最多展示 {config.media.listLimit}{" "}
        项匹配结果（可在“设置 → 上传与媒体”调整）。媒体访问权限由服务器校验，未发布文章的附件不会成为公开资源。
      </p>
      {crop && (
        <CropImage
          media={crop}
          onClose={() => setCrop(null)}
          onSaved={(m) => setMedia((prev) => [m, ...prev])}
          postId={postId}
          options={config.media}
        />
      )}{" "}
      {generate && (
        <Modal
          title="让灵感成为画面"
          onClose={() => {
            if (!operation.current.busy) setGenerate(false);
          }}
        >
          {!imageConfigured && (
            <Notice>
              还没有配置可用的图片模型。请通过部署环境安全设置服务端密钥；不会使用演示图片假装生成结果。
              <a href="/studio/settings#models">查看模型设置 ↗</a>
            </Notice>
          )}
          <label>
            图像服务商
            <select
              value={providerId}
              disabled={busy}
              onChange={(event) => setProviderId(event.target.value)}
            >
              <option value="">第一个已配置的图像服务商</option>
              {providers.map((provider) => (
                <option
                  value={provider.id}
                  key={provider.id}
                  disabled={!provider.imageConfigured}
                >
                  {provider.name} ·{" "}
                  {provider.imageModel || "服务端默认图像模型"}
                  {provider.imageConfigured
                    ? "（配置已就绪，未验证联调）"
                    : "（图像未配置）"}
                </option>
              ))}
            </select>
          </label>
          <label>
            描述你想要的图片
            <textarea
              rows={5}
              value={prompt}
              maxLength={TEXT_LIMITS.imagePrompt}
              disabled={busy}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="例如：安静的书房，午后斜照的阳光，低饱和度胶片摄影…"
            />
          </label>
          <div className="modal-actions">
            <button
              className="button"
              disabled={busy}
              onClick={() => setGenerate(false)}
            >
              取消
            </button>
            <button
              className="button primary"
              disabled={
                busy ||
                !prompt.trim() ||
                !imageConfigured ||
                !!(
                  providerId &&
                  !providers.find((p) => p.id === providerId)?.imageConfigured
                )
              }
              onClick={generateImage}
            >
              {busy ? (
                <Busy text="生成中…" />
              ) : (
                <>
                  <Sparkles size={16} />
                  生成并保存
                </>
              )}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
