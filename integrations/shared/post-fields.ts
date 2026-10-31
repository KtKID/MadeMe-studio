import type { Post } from '../../src/shared/contracts.ts';

/**
 * 每个集成客户端对服务端 Post 字段的显式决定：
 * - 'used'：客户端读取并依赖该字段（必须在 postReadSchema 中，且旧服务端可能不返回时只能是可选字段）。
 * - 'ignored'：客户端收到也不用（postReadSchema 会剥离/容忍），也不会读后回写。
 *
 * 服务端给 postSchema 新增字段时，tests/post-fields-contract.test.ts 会失败，
 * 直到这里为每个客户端都标注 'used' 或 'ignored'；删除字段时也要同步删掉这里的条目。
 * 不要用展开或循环批量生成条目：每个客户端都要逐条写清楚。
 */
export type PostField = keyof Post;
export type FieldUse = 'used' | 'ignored';
export type PostFieldManifest = { readonly [K in PostField]: FieldUse };

export const INTEGRATION_CLIENTS = ['obsidian-publisher', 'chrome-clipper', 'agent-publisher'] as const;
export type IntegrationClient = (typeof INTEGRATION_CLIENTS)[number];

export const POST_FIELD_USAGE: { readonly [C in IntegrationClient]: PostFieldManifest } = {
  // Obsidian 插件：只建草稿/发布当前笔记，摘要只显示 id、version、visibility。
  'obsidian-publisher': {
    id: 'used',
    version: 'used',
    visibility: 'used',
    title: 'ignored',
    slug: 'ignored',
    excerpt: 'ignored',
    blocks: 'ignored',
    category: 'ignored',
    categoryId: 'ignored',
    tags: 'ignored',
    coverImage: 'ignored',
    coverSettings: 'ignored',
    pinned: 'ignored',
    publishedAt: 'ignored',
    updatedAt: 'ignored',
    deletedAt: 'ignored',
    hasUnpublishedChanges: 'ignored',
    publishedVisibility: 'ignored',
  },
  // Chrome 剪藏：只建草稿，回显 id、version、visibility。
  'chrome-clipper': {
    id: 'used',
    version: 'used',
    visibility: 'used',
    title: 'ignored',
    slug: 'ignored',
    excerpt: 'ignored',
    blocks: 'ignored',
    category: 'ignored',
    categoryId: 'ignored',
    tags: 'ignored',
    coverImage: 'ignored',
    coverSettings: 'ignored',
    pinned: 'ignored',
    publishedAt: 'ignored',
    updatedAt: 'ignored',
    deletedAt: 'ignored',
    hasUnpublishedChanges: 'ignored',
    publishedVisibility: 'ignored',
  },
  // Agent CLI：建草稿/发布，输出 id、version、visibility。
  'agent-publisher': {
    id: 'used',
    version: 'used',
    visibility: 'used',
    title: 'ignored',
    slug: 'ignored',
    excerpt: 'ignored',
    blocks: 'ignored',
    category: 'ignored',
    categoryId: 'ignored',
    tags: 'ignored',
    coverImage: 'ignored',
    coverSettings: 'ignored',
    pinned: 'ignored',
    publishedAt: 'ignored',
    updatedAt: 'ignored',
    deletedAt: 'ignored',
    hasUnpublishedChanges: 'ignored',
    publishedVisibility: 'ignored',
  },
};
