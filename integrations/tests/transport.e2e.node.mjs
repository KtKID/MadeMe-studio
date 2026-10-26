import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createPostSchema } from '../../src/shared/contracts.ts';

const cli = fileURLToPath(new URL('../agent-publisher/publish.mjs', import.meta.url));
const token = `mm_${'b'.repeat(64)}`;

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
async function close(server) { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
async function command(args, origin) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { env: { ...process.env, MADEME_SITE: origin, MADEME_API_TOKEN: token }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('传输 E2E：真实 CLI 子进程 → 本地 HTTP 协议夹具 → 返回草稿摘要', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mademe-transport-'));
  const file = join(dir, 'chosen.md');
  await writeFile(file, '# Chosen note\n\nOnly this content.\n');
  const received = [];
  const { server, origin } = await listen(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    received.push({ url: request.url, method: request.method, headers: request.headers, body: JSON.parse(body) });
    response.writeHead(201, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ post: { id: 'created-post', version: 1 } }));
  });
  try {
    const output = await command(['--file', file], origin);
    assert.equal(output.code, 0, output.stderr);
    assert.deepEqual(JSON.parse(output.stdout), { id: 'created-post', version: 1, visibility: 'draft', studioUrl: `${origin}/studio` });
    assert.equal(received.length, 1);
    assert.equal(received[0].url, '/api/posts');
    assert.equal(received[0].method, 'POST');
    assert.equal(received[0].headers.authorization, `Bearer ${token}`);
    assert.equal(received[0].headers.cookie, undefined);
    assert.equal(createPostSchema.safeParse(received[0].body).success, true);
    assert.equal(received[0].body.visibility, 'draft');
    assert.equal(output.stdout.includes(token) || output.stderr.includes(token), false);
  } finally { await close(server); await rm(dir, { recursive: true, force: true }); }
});

test('传输 E2E：服务器重定向不得转发 Token 或自动重试', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mademe-redirect-'));
  const file = join(dir, 'chosen.md');
  await writeFile(file, '# Note\nBody');
  let unexpected = 0; let original = 0;
  const destination = await listen((_request, response) => { unexpected++; response.end('{}'); });
  const source = await listen((_request, response) => { original++; response.writeHead(307, { Location: `${destination.origin}/api/posts` }); response.end(); });
  try {
    const output = await command(['--file', file], source.origin);
    assert.equal(output.code, 1);
    assert.equal(original, 1);
    assert.equal(unexpected, 0);
    assert.match(output.stderr, /redirected/);
    assert.equal(output.stdout.includes(token) || output.stderr.includes(token), false);
  } finally { await close(source.server); await close(destination.server); await rm(dir, { recursive: true, force: true }); }
});
