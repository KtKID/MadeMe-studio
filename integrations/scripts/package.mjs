/** 仅打包已提交集成源码与集成文档；不读取私人数据，不安装依赖，不发网络请求。 */
import { readFile, writeFile, mkdir, mkdtemp, cp, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build, version as esbuildVersion } from 'esbuild';
import { OPAQUE_TOKEN_PATTERN } from '../../src/modules/config/limits.ts';
// 打包产物里不允许出现形似真实令牌的字符串（格式同 src/modules/config，不锚定首尾、忽略大小写）。
const TOKEN_LIKE = new RegExp(OPAQUE_TOKEN_PATTERN.source.replace(/^\^|\$$/g, ''), 'i');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(process.argv[2] || '/tmp/mademe-integrations-delivery');
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error('交付目录必须为空，避免混入旧包。');
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, encoding: 'utf8' });
const commit = run('git', ['rev-parse', 'HEAD']).trim();
const stage = await mkdtemp(resolve(tmpdir(), 'mademe-integrations-'));
const source = resolve(stage, 'source');
const hash = data => createHash('sha256').update(data).digest('hex');
const sourceFiles = run('git', ['ls-tree', '-r', '--name-only', commit, 'integrations']).trim().split('\n').filter(p => !['integrations/INSTALL.md', 'integrations/scripts/package.mjs'].includes(p));
sourceFiles.push('src/shared/contracts.ts');
const records = [];
for (const path of sourceFiles) {
  // 业务实现固定在已提交版本；仅交付说明可以读取本次编辑后的工作副本。
  const bytes = path.endsWith('.md') ? await readFile(resolve(root, path)) : execFileSync('git', ['show', `${commit}:${path}`], { cwd: root });
  if (TOKEN_LIKE.test(bytes.toString())) throw new Error(`疑似真实 Token: ${path}`);
  await mkdir(dirname(resolve(source, path)), { recursive: true });
  await writeFile(resolve(source, path), bytes);
  records.push({ path, sha256: hash(bytes), provenance: path.endsWith('.md') ? 'working-tree-doc' : commit });
}
await symlink(resolve(root, 'node_modules'), resolve(source, 'node_modules'));
console.log(run(process.execPath, ['--test', ...sourceFiles.filter(p => p.endsWith('.node.mjs')).map(p => resolve(source, p))], source));
console.log(run(process.execPath, [resolve(source, 'integrations/chrome-clipper/build.mjs')], source));
console.log(run(process.execPath, [resolve(source, 'integrations/obsidian-publisher/esbuild.config.mjs')], source));
const payload = resolve(stage, 'payload');
await mkdir(payload);
await cp(resolve(source, 'integrations/chrome-clipper/dist'), resolve(payload, 'mademe-chrome-clipper'), {recursive:true});
await cp(resolve(source, 'integrations/obsidian-publisher/dist'), resolve(payload, 'mademe-publisher'), {recursive:true});
const cli = resolve(payload, 'mademe-agent-publisher');
await mkdir(cli);
await build({ entryPoints: [resolve(source, 'integrations/agent-publisher/publish.mjs')], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: resolve(cli, 'publish.mjs'), sourcemap: false, minify: false });
for (const name of ['README.md', 'SKILL.md']) await cp(resolve(source, 'integrations/agent-publisher', name), resolve(cli, name));
console.log(run(process.execPath, [resolve(cli, 'publish.mjs'), '--help'], stage));
const smoke = JSON.parse(run(process.execPath, [resolve(cli, 'publish.mjs'), '--file', resolve(source, 'integrations/tests/fixtures/publish-smoke.md'), '--dry-run', '--site', 'https://your-site.example'], stage));
if (!JSON.stringify(smoke).includes('draft')) throw new Error('CLI 草稿预检失败');
await cp(resolve(root, 'integrations/INSTALL.md'), resolve(output, '安装说明.md'));
const zodRoot = resolve(root, 'node_modules/zod');
await cp(resolve(zodRoot, 'LICENSE'), resolve(payload, 'THIRD_PARTY_ZOD_LICENSE.txt'));
const sourcePack = resolve(payload, 'mademe-integrations-source');
for (const {path} of records) {
  await mkdir(dirname(resolve(sourcePack, path)), {recursive:true});
  await cp(resolve(source, path), resolve(sourcePack, path));
}
await mkdir(resolve(sourcePack, 'integrations/scripts'), {recursive:true});
await cp(fileURLToPath(import.meta.url), resolve(sourcePack, 'integrations/scripts/package.mjs'));
await cp(resolve(root, 'integrations/INSTALL.md'), resolve(sourcePack, 'integrations/INSTALL.md'));
for (const dir of ['mademe-chrome-clipper', 'mademe-publisher', 'mademe-agent-publisher']) await cp(resolve(payload, 'THIRD_PARTY_ZOD_LICENSE.txt'), resolve(payload, dir, 'THIRD_PARTY_ZOD_LICENSE.txt'));
for (const path of ['integrations/scripts/package.mjs', 'integrations/INSTALL.md']) records.push({path, sha256:hash(await readFile(resolve(root,path))), provenance:'working-tree-packaging'});
const archives = [];
for (const dir of ['mademe-chrome-clipper', 'mademe-publisher', 'mademe-agent-publisher', 'mademe-integrations-source']) {
  const name = `${dir}-0.1.0.zip`;
  // Python 标准库按成员白名单递归打包并复读，禁绝符号链接和敏感路径。
  run('python3', ['-c', `import pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[1]); out=sys.argv[2]\nfiles=sorted(p for p in root.rglob('*') if p.is_file())\nwith zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:\n for p in files:\n  assert not p.is_symlink()\n  assert not any(x in ('node_modules','.git','data.json','.env','.dev.vars') for x in p.parts)\n  z.write(p,str(p.relative_to(root.parent)))\nwith zipfile.ZipFile(out) as z:\n assert z.testzip() is None\n assert len(z.namelist()) == len(files)\n print('validated',len(files),'members')`, resolve(payload, dir), resolve(output, name)], stage);
  const members = run('unzip', ['-Z1', resolve(output, name)], stage).trim().split('\n');
  archives.push({ name, sha256: hash(await readFile(resolve(output, name))), members });
}
const chrome = JSON.parse(await readFile(resolve(payload, 'mademe-chrome-clipper/manifest.json')));
const obsidian = JSON.parse(await readFile(resolve(payload, 'mademe-publisher/manifest.json')));
if (chrome.host_permissions || chrome.content_scripts || chrome.background || chrome.action.default_popup !== 'popup.html') throw new Error('Chrome 权限/入口异常');
if (obsidian.id !== 'mademe-publisher') throw new Error('Obsidian 目录 ID 不匹配');
await cp(resolve(payload, 'THIRD_PARTY_ZOD_LICENSE.txt'), resolve(output, 'THIRD_PARTY_ZOD_LICENSE.txt'));
await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, sourceCommit: commit, versions: {chrome: chrome.version, obsidian: obsidian.version, cli: '0.1.0', node:process.version, esbuild:esbuildVersion, zod:JSON.parse(await readFile(resolve(zodRoot,'package.json'))).version}, permissions: chrome.permissions, optionalHostPermissions: chrome.optional_host_permissions, sourceFiles: records, archives, verification: ['19 local integration tests', 'Chrome and Obsidian builds', 'CLI offline help and dry-run', 'zip CRC and member allowlist'], limitations: ['未在真实 Chrome 或 Obsidian 宿主安装验收', '未调用真实 API 或创建 Token', '业务源码固定 sourceCommit；文档包含本次保留测试文章规则'] }, null, 2)+'\n');
const sums=[];
for (const name of (await readdir(output)).sort()) sums.push(`${hash(await readFile(resolve(output,name)))}  ${name}`);
await writeFile(resolve(output,'SHA256SUMS'), sums.join('\n')+'\n');
console.log(`交付完成: ${output}`);
