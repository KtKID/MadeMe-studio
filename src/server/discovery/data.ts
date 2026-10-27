import { getEnv, type RequestContext } from "../runtime";
import { D1PostRepository } from "../content/repository";
import { publicPosts } from "../content/service";
import { readSettings } from "../settings";

export async function discover(context: RequestContext) {
  const env = getEnv(context);
  const posts = env.DB
    ? publicPosts(await new D1PostRepository(env.DB).list())
    : [];
  const settings = await readSettings(env);
  return {
    posts,
    title: settings.siteTitle,
    /** 设置页“嵌入与阅读 → RSS 条目数”。 */
    rssItems: settings.limits.reading.rssItems,
    origin: new URL(context.request.url).origin,
  };
}
