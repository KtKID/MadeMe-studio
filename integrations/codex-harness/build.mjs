import { build } from "esbuild";
import { mkdir, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL(".", import.meta.url));
await import("./console/build.mjs");
await mkdir(join(root, "dist"), { recursive: true });
await build({
  entryPoints: [join(root, "start.ts")],
  outfile: join(root, "dist/start.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
});
await cp(join(root, "console/dist"), join(root, "dist/console"), {
  recursive: true,
});
console.log("Local harness built; no App Server, login or model started.");
