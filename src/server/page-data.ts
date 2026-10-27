import {
  postSummarySchema,
  mediaListResponseSchema,
  tokensResponseSchema,
  type DashboardBootstrap,
} from "../shared/contracts";
import { listMedia } from "./media/service";
import { listTokens } from "./tokens";
import { providerCapabilities } from "./ai/capabilities";
import { hasConfiguredImageProvider } from "./ai/images";
import type { BootstrapResponse, Post, Settings } from "../shared/contracts";
import { getEnv, type RequestContext } from "./runtime";
import { authenticate, ownerConfigured } from "./auth/identity";
import { canReadPost } from "./auth/access";
import { D1PostRepository, type StoredPost } from "./content/repository";
import { publicPosts } from "./content/service";
import { readSettings, redactSettings } from "./settings";
export async function loadPageData(
  context: RequestContext,
  publicOnly = false,
  options:
    { posts: "none" | "single"; id?: string | null } | undefined = undefined,
): Promise<BootstrapResponse> {
  const env = getEnv(context);
  // 身份与站点设置互不依赖；避免每次导航串行等待数据库。
  const [identity, settings] = await Promise.all([
    authenticate(context.request, env),
    readSettings(env),
  ]);
  let rows: StoredPost[] = [];
  if (env.DB && options?.posts !== "none") {
    const repository = new D1PostRepository(env.DB);
    if (options?.posts === "single") {
      // 后台编辑仅查询目标文章，不为未授权访问读取草稿。
      if (identity.owner && options.id) {
        const row = await repository.get(options.id);
        if (row) rows = [row];
      }
    } else rows = await repository.list();
  }
  return {
    posts:
      identity.owner && !publicOnly
        ? rows.map((r) => r.draft)
        : publicPosts(rows),
    settings: redactSettings(settings, identity.owner && !publicOnly, env),
    capabilities: {
      authenticated: identity.owner,
      aiConfigured:
        identity.owner &&
        settings.providers.some(
          (p) => providerCapabilities(p, env).textConfigured,
        ),
      imageConfigured:
        identity.owner && hasConfiguredImageProvider(settings.providers, env),
      passwordConfigured:
        identity.owner &&
        !!env.SESSION_SECRET &&
        env.SESSION_SECRET.length >= 32,
      storageConfigured: !!(env.DB && env.BUCKET),
      ownerConfigured: ownerConfigured(env),
    },
  };
}
export async function loadPostPage(
  context: RequestContext,
  slug: string,
): Promise<{
  post: Post | null;
  locked: boolean;
  authenticated: boolean;
  settings: Settings;
}> {
  const env = getEnv(context);
  const identity = await authenticate(context.request, env);
  const settings = redactSettings(await readSettings(env), identity.owner, env);
  const result = {
    post: null as Post | null,
    locked: false,
    authenticated: identity.owner,
    settings,
  };
  if (!env.DB) return result;
  const row = await new D1PostRepository(env.DB).bySlug(slug);
  if (!row) return result;
  if (identity.owner) {
    return { ...result, post: row.published ?? row.draft };
  }
  if (row.draft.deletedAt || row.published?.slug !== slug) return result;
  if (!(await canReadPost(context.request, env, identity, row)))
    return { ...result, locked: row.published?.visibility === "password" };
  return { ...result, post: row.published };
}

/** 首页始终读取公开发布快照；作者身份只用于显示进入工作台的能力。 */
export function loadPublicPageData(context: RequestContext) {
  return loadPageData(context, true);
}

/** 授权后才读取草稿摘要；访客继续使用既有公开发布快照语义。 */
export async function loadDashboardPageData(
  context: RequestContext,
): Promise<DashboardBootstrap> {
  const data = await loadPageData(context, false, { posts: "none" });
  const env = getEnv(context);
  const posts = !env.DB
    ? []
    : data.capabilities.authenticated
      ? await new D1PostRepository(env.DB).listSummaries()
      : publicPosts(await new D1PostRepository(env.DB).list()).map((post) =>
          postSummarySchema.parse(post),
        );
  return { ...data, posts };
}

/** 私有资源在身份核验之后 SSR 读取；错误不会伪装成空列表已就绪。 */
export async function loadMediaPageData(context: RequestContext) {
  const data = await loadPageData(context, false, { posts: "none" });
  let initialMedia: import("../shared/contracts").Media[] = [];
  let initialError = "";
  if (data.capabilities.authenticated) {
    try {
      const env = getEnv(context);
      if (!env.DB) throw new Error("Storage unavailable");
      initialMedia = mediaListResponseSchema.parse({
        media: await listMedia(env, "", null),
      }).media;
    } catch {
      initialError = "媒体加载失败，请刷新后重试。";
    }
  }
  return { ...data, initialMedia, initialError };
}
export async function loadIntegrationsPageData(context: RequestContext) {
  const data = await loadPageData(context, false, { posts: "none" });
  let initialTokens: import("../shared/contracts").APIToken[] = [];
  let initialError = "";
  if (data.capabilities.authenticated) {
    try {
      const env = getEnv(context);
      if (!env.DB) throw new Error("Storage unavailable");
      initialTokens = tokensResponseSchema.parse({
        tokens: await listTokens(env),
      }).tokens;
    } catch {
      initialError = "令牌列表加载失败，请刷新后重试。";
    }
  }
  return { ...data, initialTokens, initialError };
}
