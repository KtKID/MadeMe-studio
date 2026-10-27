import { clientCaught, clientLog } from "./client-log";
import { useEffect, useRef, type ReactNode } from "react";
import { parseApiResponse, parseApiError } from "./api-protocol";
import { ModalStack } from "./modal-stack";
const modalLayers = new ModalStack();
import { LoaderCircle, X, Feather, Search } from "lucide-react";
export type { Post, Settings, Media } from "../../shared/contracts";
export type { BootstrapResponse as Bootstrap } from "../../shared/contracts";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const path = url.split("?")[0];
  const method = options.method || "GET";
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        ...options.headers,
      },
    });
  } catch (error) {
    clientCaught("api.network_failed", error, { path, method });
    throw error;
  }
  // 状态码已知即撤下私有界面，不等待可能迟到的错误正文。
  if (typeof window !== "undefined" && [401, 403].includes(response.status))
    window.dispatchEvent(new Event("mademe:identity-invalid"));
  const data = await response.json().catch((error: unknown) => {
    clientCaught("api.unreadable_response", error, {
      path,
      method,
      status: response.status,
    });
    return { error: { message: "服务器返回了无法读取的响应。" } };
  });
  if (!response.ok) {
    const error = parseApiError(data);
    clientLog(response.status >= 500 ? "error" : "warn", "api.request_failed", {
      path,
      method,
      status: response.status,
      code: error.code,
    });
    throw new ApiError(response.status, error.code, error.message);
  }
  try {
    return parseApiResponse(data, url, method) as T;
  } catch (error) {
    clientCaught("api.protocol_mismatch", error, { path, method }, "error");
    throw new ApiError(
      502,
      "INVALID_RESPONSE",
      "服务器返回的数据格式与当前界面不一致，请刷新后重试。",
    );
  }
}
// 模块内复用 formatter，保持 SSR / 浏览器一致的作者时区。
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "short",
  day: "numeric",
});
export function date(value: string | null | undefined) {
  return value ? dateFormatter.format(new Date(value)) : "尚未发布";
}
export const visibilityLabels = {
  public: "公开",
  draft: "草稿",
  password: "密码保护",
  unlisted: "不公开列出",
};
export function Notice({
  children,
  kind = "info",
}: {
  children: ReactNode;
  kind?: "info" | "error" | "success";
}) {
  return (
    <div
      className={`notice notice-${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-mark">
        <Feather size={28} />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const layer = Symbol("dialog");
    modalLayers.push(layer);
    dialog.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (!modalLayers.isTop(layer)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
      );
      if (!elements?.length) return;
      const first = elements[0],
        last = elements[elements.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialog.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      modalLayers.remove(layer);
      if (previous?.isConnected && !previous.closest("[hidden], [inert]"))
        previous.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "modal-wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
export function Busy({ text = "处理中" }: { text?: string }) {
  return (
    <span className="busy">
      <LoaderCircle size={16} className="spin" />
      {text}
    </span>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "搜索文章、标签…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search-box">
      <Search size={17} />
      <input
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
    </label>
  );
}
export function downloadText(
  filename: string,
  text: string,
  type = "text/markdown;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const u = new URL(value, "https://local.invalid");
    if (!["http:", "https:"].includes(u.protocol)) return;
    if (value.startsWith("/") && !value.startsWith("//")) return value;
    return u.href;
  } catch {
    return;
  }
}
