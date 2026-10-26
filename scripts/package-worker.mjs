import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
// Astro 使用 entry.mjs，托管入口采用稳定的 index.js；保持原构建产物和相对导入。
if (!existsSync("dist/server/entry.mjs"))
  throw new Error("缺少 Cloudflare Worker 构建入口");
writeFileSync(
  "dist/server/index.js",
  "export { default } from './entry.mjs';\n",
);
mkdirSync("dist/.openai", { recursive: true });
copyFileSync(".openai/hosting.json", "dist/.openai/hosting.json");
