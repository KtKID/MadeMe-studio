import { hasConfiguredImageProvider } from "./ai/images";
import type { BootstrapResponse, Post, Settings } from "../shared/contracts";
import { getEnv, type RequestContext } from "./runtime";
import { authenticate, ownerConfigured } from "./auth/identity";
import { canReadPost } from "./auth/access";
import { D1PostRepository } from "./content/repository";
import { publicPosts } from "./content/service";
import { readSettings, redactSettings, providerKey } from "./settings";
export async function loadPageData(
  context: RequestContext,
  publicOnly = false,
): Promise<BootstrapResponse> {
  const env = getEnv(context);
  const identity = await authenticate(context.request, env);
  const settings = await readSettings(env);
  const rows = env.DB ? await new D1PostRepository(env.DB).list() : [];
  return {
    posts:
      identity.owner && !publicOnly
        ? rows.map((r) => r.draft)
        : publicPosts(rows),
    settings: redactSettings(settings, identity.owner && !publicOnly, env),
    capabilities: {
      authenticated: identity.owner,
      aiConfigured:
        identity.owner && settings.providers.some((p) => !!providerKey(p, env)),
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
