import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
// 构建缓存位于临时目录，不改动宿主的全局配置。
const result = spawnSync(
  process.execPath,
  ["node_modules/astro/bin/astro.mjs", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ASTRO_TELEMETRY_DISABLED: "1",
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG_PATH: join(tmpdir(), "mademe-wrangler.log"),
      XDG_CONFIG_HOME:
        process.env.XDG_CONFIG_HOME || join(tmpdir(), "mademe-config"),
    },
  },
);
process.exit(result.status ?? 1);
