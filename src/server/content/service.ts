import type {
  CreatePostInput,
  PatchPostInput,
  Post,
  Revision,
  Visibility,
} from "../../shared/contracts";
import type { PostRepository, StoredPost } from "./repository";
import { AppError, notFound } from "../errors";
import { hashPassword } from "../auth/crypto";
import { slugify, validateContent } from "./validation";
import { markdownToBlocks } from "./markdown";
export class PostService {
  constructor(readonly repository: PostRepository) {}
  async create(input: CreatePostInput) {
    if (input.markdown !== undefined) {
      if (input.blocks.length)
        throw new AppError(
          422,
          "CONTENT_AMBIGUOUS",
          "Supply markdown or blocks, not both.",
        );
      input = { ...input, blocks: markdownToBlocks(input.markdown) };
    }
    validateContent(input.blocks);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const { password, markdown, ...fields } = input;
    const draft: Post = {
      id,
      slug: input.slug || `${slugify(input.title)}-${id.slice(0, 6)}`,
      excerpt: "",
      category: "",
      tags: [],
      coverImage: "",
      visibility: "draft",
      pinned: false,
      ...fields,
      version: 1,
      publishedAt: null,
      updatedAt: now,
      deletedAt: null,
    };
    const row: StoredPost = {
      draft,
      published: null,
      passwordHash: password ? await hashPassword(password) : null,
      publishedPasswordHash: null,
    };
    await this.repository.create(row);
    return draft;
  }
  async update(id: string, input: PatchPostInput) {
    const row = await this.mustGet(id);
    this.checkVersion(row, input.version);
    if (row.draft.deletedAt)
      throw new AppError(
        409,
        "POST_DELETED",
        "Restore the article before editing it.",
      );
    const { version, password, ...patch } = input;
    if (patch.blocks) validateContent(patch.blocks);
    if (password) row.passwordHash = await hashPassword(password);
    row.draft = {
      ...row.draft,
      ...patch,
      version: version + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.commit(row, version, "save");
    return row.draft;
  }
  async publish(
    id: string,
    input: {
      version: number;
      visibility?: Exclude<Visibility, "draft">;
      password?: string;
    },
  ) {
    const row = await this.mustGet(id);
    this.checkVersion(row, input.version);
    if (row.draft.deletedAt)
      throw new AppError(
        409,
        "POST_DELETED",
        "Restore the article before publishing.",
      );
    validateContent(row.draft.blocks);
    const visibility =
      input.visibility ??
      (row.draft.visibility === "draft" ? "public" : row.draft.visibility);
    if (input.password) row.passwordHash = await hashPassword(input.password);
    if (visibility === "password" && !row.passwordHash)
      throw new AppError(
        422,
        "PASSWORD_REQUIRED",
        "Set a password of at least 8 characters before publishing.",
      );
    const now = new Date().toISOString();
    row.draft = {
      ...row.draft,
      visibility,
      version: input.version + 1,
      publishedAt: row.draft.publishedAt ?? now,
      updatedAt: now,
    };
    row.published = structuredClone(row.draft);
    row.publishedPasswordHash =
      visibility === "password" ? row.passwordHash : null;
    await this.commit(row, input.version, "publish");
    return row.draft;
  }
  async unpublish(id: string, version: number) {
    const row = await this.mustGet(id);
    this.checkVersion(row, version);
    row.draft = {
      ...row.draft,
      visibility: "draft",
      publishedAt: null,
      version: version + 1,
      updatedAt: new Date().toISOString(),
    };
    row.published = null;
    row.publishedPasswordHash = null;
    await this.commit(row, version, "save");
    return row.draft;
  }
  async remove(id: string, version: number) {
    const row = await this.mustGet(id);
    this.checkVersion(row, version);
    const now = new Date().toISOString();
    row.draft = {
      ...row.draft,
      deletedAt: now,
      updatedAt: now,
      version: version + 1,
    };
    await this.commit(row, version, "delete");
    return row.draft;
  }
  async restore(id: string, version: number) {
    const row = await this.mustGet(id);
    this.checkVersion(row, version);
    row.draft = {
      ...row.draft,
      deletedAt: null,
      updatedAt: new Date().toISOString(),
      version: version + 1,
    };
    await this.commit(row, version, "undelete");
    return row.draft;
  }
  async restoreRevision(
    id: string,
    revisionVersion: number,
    currentVersion: number,
  ) {
    const row = await this.mustGet(id);
    this.checkVersion(row, currentVersion);
    const revision = await this.repository.revision(id, revisionVersion);
    if (!revision) throw notFound();
    row.draft = {
      ...revision,
      id,
      version: currentVersion + 1,
      publishedAt: row.draft.publishedAt,
      deletedAt: row.draft.deletedAt,
      updatedAt: new Date().toISOString(),
    };
    await this.commit(row, currentVersion, "restore");
    return row.draft;
  }
  async mustGet(id: string) {
    const row = await this.repository.get(id);
    if (!row) throw notFound();
    return row;
  }
  private checkVersion(row: StoredPost, version: number) {
    if (row.draft.version !== version)
      throw new AppError(
        409,
        "VERSION_CONFLICT",
        "This article changed elsewhere. Reload before saving.",
        { currentVersion: row.draft.version },
      );
  }
  private async commit(
    row: StoredPost,
    expected: number,
    reason: Revision["reason"],
  ) {
    if (!(await this.repository.save(row, expected, reason)))
      throw new AppError(
        409,
        "VERSION_CONFLICT",
        "This article changed elsewhere. Reload before saving.",
      );
  }
}
export function publicPosts(rows: StoredPost[]) {
  return rows
    .filter((r) => !r.draft.deletedAt && r.published?.visibility === "public")
    .map((r) => r.published!)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""),
    );
}
