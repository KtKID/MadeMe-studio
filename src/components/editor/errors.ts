import { ApiError } from "../shared/ui";

/** 编辑器里会失败的操作，用作提示前缀与日志字段。 */
export type EditorAction =
  | "save"
  | "publish"
  | "unpublish"
  | "reload"
  | "import"
  | "ai"
  | "revisions"
  | "restore";

const actionNames: Record<EditorAction, string> = {
  save: "保存",
  publish: "发布",
  unpublish: "撤下",
  reload: "载入最新版本",
  import: "导入",
  ai: "AI 生成",
  revisions: "读取历史版本",
  restore: "恢复版本",
};

const CJK = /[\u3400-\u9fff]/;

/** 422 VALIDATION_ERROR 的字段路径，例如 blocks.3.props.url → “第 4 个块的 props.url”。 */
function validationFields(details: unknown) {
  if (!Array.isArray(details)) return "";
  const paths = details
    .slice(0, 3)
    .map((d) => (d as { path?: unknown }).path)
    .filter(Array.isArray)
    .map((path) => {
      const [head, index, ...rest] = path as (string | number)[];
      return head === "blocks" && typeof index === "number"
        ? `第 ${index + 1} 个块${rest.length ? `的 ${rest.join(".")}` : ""}`
        : path.join(".");
    });
  return paths.length ? `（${paths.join("；")}）` : "";
}

/**
 * 把保存 / 发布等操作的异常转成面向作者的中文提示，并带上操作名。
 * 服务端已经给出中文原因（如“第 2 个视频块……”）时原样使用；英文原因按错误码翻译，
 * 认不出的错误码保留原文与错误码，保证排查时能对上日志。
 */
export function describeEditorError(action: EditorAction, error: unknown) {
  const name = actionNames[action];
  if (error instanceof ApiError) {
    if (CJK.test(error.message)) return `${name}失败：${error.message}`;
    switch (error.code) {
      case "VERSION_CONFLICT":
        return `${name}失败：另一个窗口已保存了更新，请先备份本页内容，再载入最新版本。`;
      case "POST_DELETED":
        return `${name}失败：这篇文章已被删除（可在写作台的回收站恢复）。`;
      case "SLUG_CONFLICT":
        return `${name}失败：链接标识已被其他文章使用，请在“文章设置”里换一个。`;
      case "CONTENT_TOO_LARGE":
      case "PAYLOAD_TOO_LARGE":
        return `${name}失败：文章内容过大（上限约 1 MB），请删减或拆成多篇。`;
      case "INVALID_CONTENT":
        return `${name}失败：正文嵌套层级或内容块数量超出上限。`;
      case "VALIDATION_ERROR":
        return `${name}失败：提交的内容格式有误${validationFields(error.details)}，请检查后重试。`;
      case "PASSWORD_REQUIRED":
        return `${name}失败：密码保护发布需要设置至少 8 位的访问密码。`;
      case "RATE_LIMITED":
        return `${name}失败：操作太频繁，请稍等一会儿再试。`;
      case "UNAUTHORIZED":
      case "INVALID_TOKEN":
      case "CSRF_REJECTED":
      case "AUTH_ORIGIN_REJECTED":
        return `${name}失败：登录状态已失效，请在新标签页重新登录后再试（本页内容仍在，不要关闭）。`;
      default:
        return `${name}失败：${error.message}（${error.code}）`;
    }
  }
  if (error instanceof TypeError)
    return `${name}失败：网络连接中断，请检查网络后重试（本页内容仍在）。`;
  const message = error instanceof Error ? error.message : String(error);
  return `${name}失败：${message}`;
}
