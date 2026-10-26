import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('./', import.meta.url);
const output = new URL('dist/', root);
await mkdir(output, { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL('src/main.ts', root))],
  bundle: true, external: ['obsidian'], format: 'cjs', platform: 'browser',
  target: 'es2022', minify: true, sourcemap: false,
  outfile: fileURLToPath(new URL('main.js', output)),
  banner: { js: '/* 构建产物；源码位于 integrations/obsidian-publisher/src。 */' },
});
for (const file of ['manifest.json', 'styles.css']) await copyFile(new URL(file, root), new URL(file, output));
console.log(`Obsidian plugin built: ${fileURLToPath(output)}`);
