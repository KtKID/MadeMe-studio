import { defineConfig } from "@playwright/test";

// 使用临时浏览器配置运行验收，不读取个人浏览器数据。
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.BASE_URL || "http://127.0.0.1:4321",
    browserName: "chromium",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    },
  },
  reporter: "list",
});
