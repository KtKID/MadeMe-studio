import {
  apiErrorSchema,
  bootstrapResponseSchema,
  postResponseSchema,
  postsResponseSchema,
  settingsResponseSchema,
  deploymentResponseSchema,
  mediaResponseSchema,
  mediaListResponseSchema,
  aiResponseSchema,
  modelsResponseSchema,
  tokensResponseSchema,
  tokenCreatedResponseSchema,
  revisionsResponseSchema,
  unlockResponseSchema,
  revokeTokenResponseSchema,
  identityResponseSchema,
} from "../../shared/contracts";
/** 按端点选择唯一共享 Zod 协议；未知端点和任意 success 对象一律拒绝。 */
export function parseApiResponse(
  data: unknown,
  url: string,
  method = "GET",
): unknown {
  const path = new URL(url, "https://local.invalid").pathname;
  const verb = method.toUpperCase();
  if (path === "/api/bootstrap" && verb === "GET")
    return bootstrapResponseSchema.parse(data);
  if (path === "/api/identity" && verb === "GET")
    return identityResponseSchema.parse(data);
  if (path === "/api/settings" && ["GET", "PATCH"].includes(verb))
    return settingsResponseSchema.parse(data);
  if (path === "/api/deployment" && verb === "GET")
    return deploymentResponseSchema.parse(data);
  if (path === "/api/posts")
    return (verb === "GET" ? postsResponseSchema : postResponseSchema).parse(
      data,
    );
  if (/^\/api\/posts\/[^/]+\/unlock$/.test(path) && verb === "POST")
    return unlockResponseSchema.parse(data);
  if (/^\/api\/posts\/[^/]+\/revisions$/.test(path) && verb === "GET")
    return revisionsResponseSchema.parse(data);
  if (
    /^\/api\/posts\/[^/]+(?:\/(?:publish|unpublish|restore)|\/revisions\/\d+\/restore)?$/.test(
      path,
    )
  )
    return postResponseSchema.parse(data);
  if (path === "/api/media")
    return (
      verb === "GET" ? mediaListResponseSchema : mediaResponseSchema
    ).parse(data);
  if (path === "/api/images/generate" && verb === "POST")
    return mediaResponseSchema.parse(data);
  if (path === "/api/ai" && verb === "POST")
    return aiResponseSchema.parse(data);
  if (/^\/api\/providers\/[^/]+\/models$/.test(path) && verb === "GET")
    return modelsResponseSchema.parse(data);
  if (path === "/api/tokens" && verb === "GET")
    return tokensResponseSchema.parse(data);
  if (path === "/api/tokens" && verb === "POST")
    return tokenCreatedResponseSchema.parse(data);
  if (/^\/api\/tokens(?:\/[^/]+)?$/.test(path) && verb === "DELETE")
    return revokeTokenResponseSchema.parse(data);
  throw new Error("未定义的 API 响应协议");
}
export function parseApiError(data: unknown) {
  const result = apiErrorSchema.safeParse(data);
  return result.success
    ? result.data.error
    : { code: "REQUEST_FAILED", message: "请求未能完成，请稍后重试。" };
}
