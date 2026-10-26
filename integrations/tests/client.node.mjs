import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostSchema, publishInputSchema } from '../../src/shared/contracts.ts';
import { MAX_MARKDOWN_BYTES, clipMarkdown, createDraft, draftInput, hostPermissionPattern, normalizeMarkdown, normalizeSiteUrl, normalizeToken, publishPost, sourceUrl } from '../shared/client.ts';

const token = `mm_${'a'.repeat(64)}`;
const base = { site: 'https://writer.example', token, title: 'A note', markdown: '# A note\n\nHello.' };
const result = visibility => ({ post: {
  id: 'post-1', version: 2, visibility, title: 'Private title', slug: 'post-1',
  excerpt: 'Private excerpt', blocks: [{ type: 'paragraph', content: 'Private body' }],
  category: '', tags: [], coverImage: '', pinned: false,
  publishedAt: null, updatedAt: '2026-10-26T18:00:00.000Z', deletedAt: null,
} });

test('站点规范化：仅 HTTPS 原点或本机开发原点', () => {
  assert.equal(normalizeSiteUrl(' https://EXAMPLE.com/ '), 'https://example.com');
  assert.equal(normalizeSiteUrl('http://localhost:4321'), 'http://localhost:4321');
  assert.equal(hostPermissionPattern('https://example.com:8443'), 'https://example.com/*');
  for (const value of ['http://example.com', 'javascript:alert(1)', 'file:///tmp/a', '//example.com', 'https://user:pass@example.com', 'https://example.com/api', 'https://example.com/?token=x', 'https://example.com/#x', 'https://example.com\n', 'http://localhost.evil.test']) {
    assert.throws(() => normalizeSiteUrl(value), Error, value);
  }
});

test('Token 格式与请求头注入防护', () => {
  assert.equal(normalizeToken(` ${token} `), token);
  for (const bad of ['', 'Bearer x', `${token}\nX-Evil: yes`, 'mm_bad']) assert.throws(() => normalizeToken(bad));
});

test('Markdown 保留内容、统一换行、拒绝空白和过大文本', () => {
  assert.equal(normalizeMarkdown('\uFEFF# 标题\r\n\r内容\n'), '# 标题\n\n内容\n');
  assert.throws(() => normalizeMarkdown(' \n '));
  assert.throws(() => normalizeMarkdown('a\0b'));
  assert.throws(() => normalizeMarkdown('界'.repeat(Math.ceil(MAX_MARKDOWN_BYTES / 3))));
});

test('新建请求使用统一 Zod 协议，且任何调用方都不能越过草稿默认值', () => {
  const body = draftInput({ title: '  Example  ', markdown: 'text', visibility: 'public', blocks: [] });
  assert.deepEqual(body, { title: 'Example', markdown: 'text', visibility: 'draft' });
  assert.equal(createPostSchema.safeParse(body).success, true);
  assert.throws(() => draftInput({ title: 'line\nbreak', markdown: 'text' }));
});

test('剪藏只构造文本引用和去敏 URL，不执行页面标记', () => {
  assert.equal(sourceUrl('https://example.com/path?q=secret#token'), 'https://example.com/path');
  assert.throws(() => sourceUrl('https://user:secret@example.com/'));
  assert.throws(() => sourceUrl('chrome://settings'));
  const clipped = clipMarkdown('<script> ![image](https://evil.example)', 'https://example.com/?secret=x');
  assert.ok(clipped.startsWith('> \\<script\\>'));
  assert.ok(clipped.includes('\\!\\[image\\]'));
  assert.ok(!clipped.includes('secret'));
});

test('草稿请求只向固定 API 发 Bearer，不带 Cookie，不跟随重定向', async () => {
  let seen;
  const answer = await createDraft({ ...base, path: '/api/settings', visibility: 'public', fetchImpl: async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify(result('draft')), { status: 201 });
  } });
  assert.equal(seen.url, 'https://writer.example/api/posts');
  assert.equal(seen.init.headers.Authorization, `Bearer ${token}`);
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.redirect, 'error');
  assert.equal(seen.init.referrerPolicy, 'no-referrer');
  assert.equal(JSON.parse(seen.init.body).visibility, 'draft');
  assert.equal(answer.studioUrl, 'https://writer.example/studio');
  assert.equal(JSON.stringify(answer).includes(token), false);
});

test('不合法配置不得发出任何请求', async () => {
  let count = 0;
  const fetchImpl = async () => { count++; throw new Error('should not call'); };
  await assert.rejects(createDraft({ ...base, site: 'http://public.example', fetchImpl }));
  await assert.rejects(createDraft({ ...base, token: 'bad', fetchImpl }));
  await assert.rejects(createDraft({ ...base, title: '', fetchImpl }));
  assert.equal(count, 0);
});

test('错误不反射服务端正文或网络错误中的秘密', async () => {
  await assert.rejects(createDraft({ ...base, fetchImpl: async () => new Response(JSON.stringify({ error: { message: token } }), { status: 403 }) }), error => error.message.includes('permission') && !error.message.includes(token));
  await assert.rejects(createDraft({ ...base, fetchImpl: async () => { throw new Error(token); } }), error => !error.message.includes(token) && error.message.includes('may have succeeded'));
  await assert.rejects(createDraft({ ...base, fetchImpl: async () => new Response('<html>sign in</html>') }), /did not return JSON/);
  await assert.rejects(createDraft({ ...base, fetchImpl: async () => new Response(JSON.stringify(result('public'))) }), /non-draft/);
});

test('发布是独立请求，要求明确的文章、版本和可见性', async () => {
  let calls = 0;
  await assert.rejects(publishPost({ ...base, id: '../settings', version: 1, visibility: 'public' }));
  await assert.rejects(publishPost({ ...base, id: 'post-1', version: 0, visibility: 'public' }));
  await assert.rejects(publishPost({ ...base, id: 'post-1', version: 1, visibility: 'password' }));
  const answer = await publishPost({ ...base, id: 'post-1', version: 2, visibility: 'unlisted', fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, 'https://writer.example/api/posts/post-1/publish');
    assert.deepEqual(publishInputSchema.parse(JSON.parse(init.body)), { version: 2, visibility: 'unlisted' });
    return new Response(JSON.stringify(result('unlisted')));
  } });
  assert.equal(calls, 1);
  assert.equal(answer.visibility, 'unlisted');
});

test('仅写 Token 的草稿回执无需正文或可见性，也不额外读取文章', async () => {
  let calls = 0;
  const answer = await createDraft({ ...base, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, 'https://writer.example/api/posts');
    assert.equal(init.method, 'POST');
    return new Response(JSON.stringify({ post: { id: 'receipt-only', version: 1 } }), { status: 201 });
  } });
  assert.deepEqual(answer, { id: 'receipt-only', version: 1, visibility: 'draft', studioUrl: 'https://writer.example/studio' });
  assert.equal(calls, 1);
});

test('仅发布 Token 的最小回执采用本次明确可见性，不要求 posts:read', async () => {
  const answer = await publishPost({ ...base, id: 'post-1', version: 2, visibility: 'unlisted', fetchImpl: async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), { version: 2, visibility: 'unlisted' });
    return new Response(JSON.stringify({ post: { id: 'post-1', version: 3 } }));
  } });
  assert.deepEqual(answer, { id: 'post-1', version: 3, visibility: 'unlisted', studioUrl: 'https://writer.example/studio' });
});

test('有读取权限的完整响应仍兼容，但客户端摘要不能复制私人正文', async () => {
  const answer = await createDraft({ ...base, fetchImpl: async () => new Response(JSON.stringify(result('draft'))) });
  assert.deepEqual(Object.keys(answer).sort(), ['id', 'studioUrl', 'version', 'visibility']);
  assert.equal(JSON.stringify(answer).includes('Private'), false);
});

test('回执必须通过共同协议；不接受畸形或混入正文的最小回执', async () => {
  for (const post of [
    { id: 'post-1' }, { id: 'post-1', version: 0 }, { id: '../other', version: 1 },
    { id: 'post-1', version: 1, blocks: [{ content: 'Private body' }] },
    { id: 'post-1', version: 1, visibility: 'public' },
  ]) {
    await assert.rejects(createDraft({ ...base, fetchImpl: async () => new Response(JSON.stringify({ post })) }), /Unexpected API response/);
  }
});

