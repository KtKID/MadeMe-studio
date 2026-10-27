import { clientCaught, clientLog } from "../shared/client-log";
import {
  authLoginRequestSchema,
  authLoginResponseSchema,
  authLogoutResponseSchema,
  safeReturnTo,
} from "../../shared/auth";
/** 仅显示固定提示，避免服务端异常正文包含凭据或内部配置。 */
async function postAuth(path: string, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    clientCaught("auth.network_failed", error, { path });
    throw new Error("网络暂时不可用，请检查连接后重试。");
  }
  if (!response.ok) {
    clientLog("warn", "auth.request_failed", { path, status: response.status });
    if (response.status === 429) throw new Error("尝试次数过多，请稍后再试。");
    if (response.status === 401)
      throw new Error("邮箱或密码不正确，请重新输入。");
    if (response.status === 503)
      throw new Error("作者登录尚未配置完成，请联系站点维护者。");
    throw new Error("操作未完成，请刷新页面后重试。");
  }
  try {
    return await response.json();
  } catch (error) {
    clientCaught("auth.unreadable_response", error, { path });
    throw new Error("服务器响应无法验证，请刷新页面后重试。");
  }
}
export async function loginAuthor(input: unknown): Promise<string> {
  const request = authLoginRequestSchema.safeParse(input);
  if (!request.success) throw new Error("请输入有效邮箱和密码。");
  const result = authLoginResponseSchema.safeParse(
    await postAuth("/api/auth/login", request.data),
  );
  if (!result.success)
    throw new Error("服务器响应无法验证，请刷新页面后重试。");
  return safeReturnTo(result.data.returnTo);
}
export async function logoutAuthor(): Promise<void> {
  const result = authLogoutResponseSchema.safeParse(
    await postAuth("/api/auth/logout", {}),
  );
  if (!result.success) throw new Error("退出状态无法验证，请刷新页面后重试。");
}
