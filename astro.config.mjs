import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import cloudflare from "@astrojs/cloudflare";
import { sites } from "./scripts/vite/sites-vite-plugin.ts";
import { DEV_HOST, DEV_PORT } from "./scripts/dev-config.mjs";
export default defineConfig({
  output: "server",
  session: false,
  adapter: cloudflare({ imageService: "passthrough", inspectorPort: false }),
  integrations: [react()],
  vite: {
    plugins: [sites({ mockAuth: false })],
    ssr: { noExternal: [/^@cf-wasm\//, /^@jsquash\//] },
  },
  // 端口与地址唯一来源：scripts/dev-config.mjs（DEV_PORT 环境变量，默认 4321，只监听 127.0.0.1）。
  server: { host: DEV_HOST, port: DEV_PORT },
});
