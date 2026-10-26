#!/usr/bin/env node
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAX_MARKDOWN_BYTES, createDraft, draftInput, normalizeSiteUrl, normalizeToken, publishInput, publishPost, titleFromMarkdown } from '../shared/client.ts';

export const HELP = `MadeMe single-file publisher (Node 22.18+)

  publish.mjs [draft] --file note.md [--title "Title"] [--site https://your-site.example] [--dry-run]
  publish.mjs publish --id POST_ID --version NUMBER --visibility public|unlisted --confirm-publish [--dry-run]

Environment: MADEME_SITE, MADEME_API_TOKEN
Default: create one private draft. Token must have posts:write.
Publishing is separate and requires posts:publish plus explicit user approval.
--dry-run reads only the selected file and prints the payload; no network or token needed.
Directories, symlinks, multiple files, automatic uploads, and --token are not supported.
`;

export function parseArgs(argv) {
  const args = [...argv];
  const options = { command: 'draft' };
  if (['draft', 'publish'].includes(args[0])) options.command = args.shift();
  const valued = new Set(['file', 'title', 'site', 'id', 'version', 'visibility']);
  const switches = new Set(['help', 'dry-run', 'confirm-publish']);
  const seen = new Set();
  while (args.length) {
    const flag = args.shift();
    if (!flag.startsWith('--')) throw new Error('Use one explicit --file path; positional files and folders are not supported.');
    const name = flag.slice(2);
    if (seen.has(name)) throw new Error(`Option --${name} may only be provided once.`);
    seen.add(name);
    if (switches.has(name)) options[name] = true;
    else if (valued.has(name)) {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new Error(`Option --${name} needs a value.`);
      options[name] = value;
    } else throw new Error('Unknown option. Use --help; credentials must be provided through MADEME_API_TOKEN, never an argument.');
  }
  if (options.help) return options;
  if (options.command === 'draft') {
    if (!options.file) throw new Error('Choose exactly one Markdown file with --file.');
    if (['id', 'version', 'visibility', 'confirm-publish'].some(name => seen.has(name))) throw new Error('Draft uploads cannot publish. Use the separate publish command after reviewing the saved draft.');
  } else {
    if (options.file || options.title) throw new Error('Publishing works on an existing post ID and version; it cannot read or upload a file.');
    if (!options['confirm-publish']) throw new Error('Publishing requires explicit user approval and --confirm-publish.');
    if (!options.id || !options.version || !options.visibility) throw new Error('Publishing requires --id, --version, and --visibility public|unlisted.');
    if (!/^[1-9][0-9]*$/.test(options.version)) throw new Error('Use the exact positive integer draft version.');
  }
  return options;
}

async function readSelectedFile(filename) {
  const path = resolve(filename);
  if (!['.md', '.markdown'].includes(extname(path).toLowerCase())) throw new Error('Choose an explicit .md or .markdown file.');
  let handle;
  try {
    if (!(await lstat(path)).isFile()) throw new Error('not a regular file');
    // O_NOFOLLOW 在可用平台避免检查后替换成符号链接；只打开明确选中的一个文件。
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_MARKDOWN_BYTES) throw new Error('invalid file size/type');
    const buffer = await handle.readFile();
    if (buffer.byteLength > MAX_MARKDOWN_BYTES) throw new Error('file grew after opening');
    const markdown = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { path, markdown };
  } catch {
    throw new Error('Cannot read the selected file: use a regular UTF-8 Markdown file, not a directory or symlink, at most 512 KiB.');
  } finally { await handle?.close(); }
}

export async function runCli(argv, env = process.env, fetchImpl = globalThis.fetch) {
  const options = parseArgs(argv);
  if (options.help) return { help: HELP };
  const site = normalizeSiteUrl(options.site || env.MADEME_SITE || '');
  if (options.command === 'draft') {
    const selected = await readSelectedFile(options.file);
    const body = draftInput({ title: options.title || titleFromMarkdown(selected.markdown, basename(selected.path, extname(selected.path))), markdown: selected.markdown });
    if (options['dry-run']) return { dryRun: true, file: selected.path, endpoint: `${site}/api/posts`, requiredScope: 'posts:write', body };
    const token = normalizeToken(env.MADEME_API_TOKEN || '');
    return createDraft({ site, token, ...body, fetchImpl });
  }
  const input = publishInput({ id: options.id, version: Number(options.version), visibility: options.visibility });
  if (options['dry-run']) return { dryRun: true, endpoint: `${site}/api/posts/${input.id}/publish`, requiredScope: 'posts:publish', body: input.body };
  const token = normalizeToken(env.MADEME_API_TOKEN || '');
  return publishPost({ site, token, id: input.id, ...input.body, fetchImpl });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await runCli(process.argv.slice(2));
    process.stdout.write(result.help || `${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    // 不输出堆栈、环境变量或请求正文，避免凭据进入共享日志。
    process.stderr.write(`MadeMe: ${error instanceof Error ? error.message : 'Request failed.'}\n`);
    process.exitCode = 1;
  }
}
