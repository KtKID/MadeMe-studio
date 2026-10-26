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
    origin: new URL(context.request.url).origin,
  };
}
