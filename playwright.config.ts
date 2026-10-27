import { defineConfig } from "@playwright/test";
import { devOrigin } from "./scripts/dev-config.mjs";

// 使用临时浏览器配置运行验收，不读取个人浏览器数据。
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.BASE_URL || devOrigin(),
    browserName: "chromium",
    launchOptions: {
      ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : {}),
    },
  },
  reporter: "list",
});
