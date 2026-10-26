import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runCli } from '../agent-publisher/publish.mjs';

test('CLI 默认草稿，只接受明确参数，禁止命令行 Token', () => {
  assert.equal(parseArgs(['--file', 'one.md']).command, 'draft');
  assert.throws(() => parseArgs(['--token', 'secret']));
  assert.throws(() => parseArgs(['--file', 'a.md', '--file', 'b.md']));
  assert.throws(() => parseArgs(['publish', '--id', 'post-1', '--version', '1', '--visibility', 'public']));
  assert.throws(() => parseArgs(['draft', '--file', 'a.md', '--confirm-publish']));
});

test('CLI 冒烟：只读明确文件；dry-run 不需要 Token，也没有网络请求', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mademe-cli-'));
  try {
    const file = join(dir, 'note.md');
    await writeFile(file, '# My note\n\nSelected content.\n');
    let calls = 0;
    const result = await runCli(['--file', file, '--site', 'https://writer.example', '--dry-run'], {}, async () => { calls++; throw new Error('network disabled'); });
    assert.equal(result.dryRun, true);
    assert.equal(result.body.visibility, 'draft');
    assert.equal(result.body.title, 'My note');
    assert.equal(result.body.markdown, '# My note\n\nSelected content.\n');
    assert.equal(calls, 0);
    await mkdir(join(dir, 'folder.md'));
    await symlink(file, join(dir, 'link.md'));
    await assert.rejects(runCli(['--file', dir, '--site', 'https://writer.example', '--dry-run'], {}));
    await assert.rejects(runCli(['--file', join(dir, 'folder.md'), '--site', 'https://writer.example', '--dry-run'], {}));
    await assert.rejects(runCli(['--file', join(dir, 'link.md'), '--site', 'https://writer.example', '--dry-run'], {}));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI 发布必须提供独立确认、精确版本，并且不会隐式上传文件', async () => {
  await assert.rejects(runCli(['publish', '--id', 'post-1', '--version', '1', '--visibility', 'public', '--file', 'a.md', '--confirm-publish'], {}));
  const result = await runCli(['publish', '--site', 'https://writer.example', '--id', 'post-1', '--version', '3', '--visibility', 'unlisted', '--confirm-publish', '--dry-run'], {});
  assert.equal(result.endpoint, 'https://writer.example/api/posts/post-1/publish');
  assert.deepEqual(result.body, { version: 3, visibility: 'unlisted' });
});
