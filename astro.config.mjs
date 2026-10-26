import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import cloudflare from "@astrojs/cloudflare";
import { sites } from "./scripts/vite/sites-vite-plugin.ts";
export default defineConfig({
  output: "server",
  session: false,
  adapter: cloudflare({ imageService: "passthrough", inspectorPort: false }),
  integrations: [react()],
  vite: { plugins: [sites({ mockAuth: false })] },
  server: { host: "0.0.0.0" },
});
