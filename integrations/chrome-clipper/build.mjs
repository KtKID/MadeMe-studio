import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = new URL('./', import.meta.url);
const output = new URL('./dist/', root);
await mkdir(output, { recursive: true });
for (const name of ['manifest.json', 'popup.html', 'popup.css']) {
  await copyFile(new URL(name, root), new URL(name, output));
}
await build({ entryPoints: [fileURLToPath(new URL('popup.js', root))], bundle: true, format: 'esm', platform: 'browser', target: 'chrome102', outfile: fileURLToPath(new URL('popup.js', output)), minify: true });
const manifest = JSON.parse(await readFile(new URL('manifest.json', output), 'utf8'));
if (manifest.host_permissions || manifest.content_scripts || manifest.background) throw new Error('Unexpected persistent page access.');
await writeFile(new URL('BUILD.txt', output), 'Built from source. Load this directory unpacked for a manual Chrome test. No credentials included.\n');
console.log(`Chrome extension built: ${fileURLToPath(output)}`);
