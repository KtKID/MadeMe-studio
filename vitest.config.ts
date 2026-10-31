import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
const require = createRequire(import.meta.url);
// 单元测试在 Node 中运行真实 Photon/jSquash：workerd 入口换成 node 入口，`*.wasm?module` 编译为 WebAssembly.Module。
const wasmFiles: string[] = [];
const wasmModule = {
  name: "wasm-module-for-node",
  enforce: "pre" as const,
  resolveId(id: string) {
    if (!id.endsWith(".wasm?module")) return;
    wasmFiles.push(require.resolve(id.slice(0, -"?module".length)));
    return `\0wasm-module-${wasmFiles.length - 1}`;
  },
  load(id: string) {
    const match = id.match(/^\0wasm-module-(\d+)$/);
    if (!match) return;
    const bytes = readFileSync(wasmFiles[Number(match[1])]).toString("base64");
    return `export default new WebAssembly.Module(Uint8Array.from(atob(${JSON.stringify(bytes)}), (c) => c.charCodeAt(0)));`;
  },
};
// 浏览器与 Node CLI 的验收分别运行，避免被单元测试运行器误收集。
export default defineConfig({
  plugins: [wasmModule],
  resolve: { alias: { "@cf-wasm/photon/workerd": "@cf-wasm/photon/node" } },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
  },
});
