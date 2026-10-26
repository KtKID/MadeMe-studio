import {
  createPostSchema,
  postReceiptSchema,
  type Post,
  patchPostSchema,
  publishInputSchema,
  versionInputSchema,
  unlockInputSchema,
  patchSettingsSchema,
  aiInputSchema,
  imageInputSchema,
  createTokenSchema,
} from "../shared/contracts";
import { getEnv, type RequestContext } from "./runtime";
import { AppError, notFound } from "./errors";
import {
  authenticate,
  ownerConfigured,
  assertSameOrigin,
  requireOwner,
  requireScope,
  type Identity,
} from "./auth/identity";
import { canReadPost, makeAccessCookie } from "./auth/access";
import { sha256, verifyPassword } from "./auth/crypto";
import { D1PostRepository } from "./content/repository";
import { PostService, publicPosts } from "./content/service";
import { readSettings, redactSettings, writeSettings } from "./settings";
import { loadPageData } from "./page-data";
import { json, readJSON, boundedBody, errorResponse } from "./http";
import { listMedia, saveMedia, serveMedia } from "./media/service";
import { runAI, generateImage, listModels } from "./ai/service";
import { createToken, listTokens, revokeToken } from "./tokens";
import { rateLimit } from "./rate-limit";
export async function handleAPI(context: RequestContext): Promise<Response> {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean);
  const method = request.method.toUpperCase();
  if (method === "OPTIONS")
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      },
    });
  let response: Response;
  try {
    const env = getEnv(context);
    const identity = await authenticate(request, env);
    const write = !["GET", "HEAD"].includes(method);
    if (write) assertSameOrigin(request, identity);
    if (path[0] === "identity" && method === "GET")
      return json({
        authenticated: identity.owner,
        trustedIdentity: identity.trustedIdentity,
        ownerConfigured: ownerConfigured(env),
      });
    if (path[0] === "bootstrap" && method === "GET")
      return json(await loadPageData(context));
    if (path[0] === "settings" && path.length === 1) {
      if (method === "GET")
        return json({
          settings: redactSettings(
            await readSettings(env),
            identity.owner,
            env,
          ),
        });
      requireOwner(identity, env);
      if (!env.DB)
        throw new AppError(
          503,
          "STORAGE_NOT_CONFIGURED",
          "D1 storage is not configured.",
        );
      if (method === "PATCH")
        return json({
          settings: await writeSettings(
            env,
            await readJSON(request, patchSettingsSchema),
          ),
        });
    }
    if (!env.DB)
      throw new AppError(
        503,
        "STORAGE_NOT_CONFIGURED",
        "D1 storage is not configured.",
      );
    const repo = new D1PostRepository(env.DB);
    const posts = new PostService(repo);
    if (path[0] === "posts") {
      if (path.length === 1) {
        if (method === "GET") {
          const rows = await repo.list();
          if (identity.owner || identity.tokenId) {
            requireScope(identity, env, "posts:read");
            response = json({ posts: rows.map((r) => r.draft) });
          } else response = json({ posts: publicPosts(rows) });
          return cors(response, request, identity);
        }
        if (method === "POST") {
          requireScope(identity, env, "posts:write");
          const post = await posts.create(
            await readJSON(request, createPostSchema),
          );
          return cors(
            json({ post: mutationPost(post, identity) }, 201),
            request,
            identity,
          );
        }
      }
      const id = path[1];
      if (!id) throw notFound();
      if (path.length === 2) {
        if (method === "GET") {
          const row = await posts.mustGet(id);
          if (identity.owner || identity.tokenId) {
            requireScope(identity, env, "posts:read");
            return cors(json({ post: row.draft }), request, identity);
          }
          if (!(await canReadPost(request, env, identity, row)))
            throw notFound();
          return json({ post: row.published });
        }
        if (method === "PATCH") {
          requireScope(identity, env, "posts:write");
          return cors(
            json({
              post: mutationPost(
                await posts.update(
                  id,
                  await readJSON(request, patchPostSchema),
                ),
                identity,
              ),
            }),
            request,
            identity,
          );
        }
        if (method === "DELETE") {
          requireScope(identity, env, "posts:write");
          const input = await readJSON(request, versionInputSchema);
          return cors(
            json({
              post: mutationPost(
                await posts.remove(id, input.version),
                identity,
              ),
            }),
            request,
            identity,
          );
        }
      }
      if (path[2] === "publish" && method === "POST") {
        requireScope(identity, env, "posts:publish");
        const input = await readJSON(request, publishInputSchema);
        const row = await posts.mustGet(id);
        if (
          (input.visibility ?? row.draft.visibility) === "password" &&
          (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
        )
          throw new AppError(
            503,
            "SESSION_SETUP_REQUIRED",
            "Password publishing requires a securely configured session secret.",
          );
        return cors(
          json({
            post: mutationPost(await posts.publish(id, input), identity),
          }),
          request,
          identity,
        );
      }
      if (path[2] === "unpublish" && method === "POST") {
        requireScope(identity, env, "posts:publish");
        const input = await readJSON(request, versionInputSchema);
        return cors(
          json({
            post: mutationPost(
              await posts.unpublish(id, input.version),
              identity,
            ),
          }),
          request,
          identity,
        );
      }
      if (path[2] === "restore" && path.length === 3 && method === "POST") {
        requireScope(identity, env, "posts:write");
        // 恢复已发布文章会重新对外可见，不能借草稿写入权限绕过发布权限。
        if ((await posts.mustGet(id)).published) {
          requireScope(identity, env, "posts:publish");
        }
        const input = await readJSON(request, versionInputSchema);
        return cors(
          json({
            post: mutationPost(
              await posts.restore(id, input.version),
              identity,
            ),
          }),
          request,
          identity,
        );
      }
      if (path[2] === "revisions") {
        requireOwner(identity, env);
        if (path.length === 3 && method === "GET")
          return json({ revisions: await repo.revisions(id) });
        if (path.length === 5 && path[4] === "restore" && method === "POST") {
          const revision = Number(path[3]);
          if (!Number.isSafeInteger(revision) || revision < 1) throw notFound();
          const input = await readJSON(request, versionInputSchema);
          return json({
            post: mutationPost(
              await posts.restoreRevision(id, revision, input.version),
              identity,
            ),
          });
        }
      }
      if (path[2] === "unlock" && path.length === 3 && method === "POST") {
        const row = (await repo.get(id)) ?? (await repo.bySlug(id));
        if (
          !row ||
          row.draft.deletedAt ||
          row.published?.visibility !== "password" ||
          !row.publishedPasswordHash
        )
          throw notFound();
        const ip = await sha256(
          request.headers.get("cf-connecting-ip") ?? "anonymous",
        );
        await rateLimit(env, `unlock:${row.draft.id}:${ip}`, 8, 300);
        const input = await readJSON(request, unlockInputSchema);
        if (!(await verifyPassword(input.password, row.publishedPasswordHash)))
          throw new AppError(
            403,
            "WRONG_PASSWORD",
            "That password is not correct.",
          );
        return json({ unlocked: true }, 200, {
          "Set-Cookie": await makeAccessCookie(request, env, row),
        });
      }
    }
    if (path[0] === "files" && path.length === 2 && method === "GET")
      return await serveMedia(request, env, identity, path[1]);
    if (path[0] === "media" && path.length === 1) {
      if (method === "GET") {
        requireOwner(identity, env);
        return json({
          media: await listMedia(
            env,
            url.searchParams.get("q") ?? "",
            url.searchParams.get("source"),
          ),
        });
      }
      if (method === "POST") {
        requireScope(identity, env, "media:write");
        if (
          !request.headers
            .get("content-type")
            ?.startsWith("multipart/form-data")
        )
          throw new AppError(
            415,
            "MULTIPART_REQUIRED",
            "Use multipart/form-data to upload files.",
          );
        const body = await boundedBody(request, 26 * 1024 * 1024);
        const form = await new Request(request.url, {
          method: "POST",
          headers: { "Content-Type": request.headers.get("content-type")! },
          body,
        }).formData();
        const file = form.get("file");
        if (!file || typeof file === "string")
          throw new AppError(422, "FILE_REQUIRED", "Choose a file to upload.");
        const postId = form.get("postId");
        return cors(
          json(
            {
              media: await saveMedia(
                env,
                new Uint8Array(await file.arrayBuffer()),
                {
                  name: file.name,
                  mime: file.type,
                  postId:
                    typeof postId === "string" && postId ? postId : undefined,
                },
              ),
            },
            201,
          ),
          request,
          identity,
        );
      }
    }
    if (path[0] === "ai" && path.length === 1 && method === "POST") {
      requireOwner(identity, env);
      await rateLimit(env, `ai:owner`, 20);
      const input = await readJSON(request, aiInputSchema);
      if (input.postId) await posts.mustGet(input.postId);
      return json(await runAI(env, input));
    }
    if (path[0] === "images" && path[1] === "generate" && method === "POST") {
      requireOwner(identity, env);
      await rateLimit(env, `images:owner`, 5, 300);
      const input = await readJSON(request, imageInputSchema);
      if (input.postId) await posts.mustGet(input.postId);
      return json({ media: await generateImage(env, input) }, 201);
    }
    if (
      path[0] === "providers" &&
      path.length === 3 &&
      path[2] === "models" &&
      method === "GET"
    ) {
      requireOwner(identity, env);
      const provider = (await readSettings(env)).providers.find(
        (p) => p.id === path[1],
      );
      if (!provider) throw notFound();
      return json({ models: await listModels(env, provider) });
    }
    if (path[0] === "tokens") {
      requireOwner(identity, env);
      if (method === "GET" && path.length === 1)
        return json({ tokens: await listTokens(env) });
      if (method === "POST" && path.length === 1)
        return json(
          await createToken(env, await readJSON(request, createTokenSchema)),
          201,
        );
      if (method === "DELETE") {
        const id = path[1] ?? url.searchParams.get("id");
        if (!id)
          throw new AppError(
            422,
            "TOKEN_ID_REQUIRED",
            "Choose a token to revoke.",
          );
        await revokeToken(env, id);
        return json({ revoked: true });
      }
    }
    throw notFound();
  } catch (error) {
    response = errorResponse(error);
  }
  // 浏览器会话响应不开放跨域；只有显式 Bearer 令牌响应开放无凭据 CORS。
  if (request.headers.get("authorization")?.startsWith("Bearer ")) {
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Vary", "Origin");
  }
  return response;
}
function cors(response: Response, request: Request, identity: Identity) {
  if (identity.tokenId && request.headers.get("authorization")) {
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Vary", "Origin");
  }
  return response;
}

function mutationPost(post: Post, identity: Identity) {
  return identity.owner || identity.scopes.includes("posts:read")
    ? post
    : postReceiptSchema.parse({ id: post.id, version: post.version });
}
