import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
const root = new URL("./", import.meta.url);
const dist = new URL("./dist/", root);
await mkdir(dist, { recursive: true });
await build({
  entryPoints: [new URL("./main.tsx", root).pathname],
  outfile: new URL("./console.js", dist).pathname,
  bundle: true,
  minify: true,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
await copyFile(new URL("./index.html", root), new URL("./index.html", dist));
