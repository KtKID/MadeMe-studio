import { runLocalWorkerSuite } from "./local-worker-runner.mjs";
import { DEV_PORT } from "./dev-config.mjs";
// 全新临时 D1/R2 与明确测试身份；结束清理进程/数据，不连接生产或私人 vault。
await runLocalWorkerSuite({
  instances: [
    {
      name: "obsidian-e2e-owner",
      port: DEV_PORT,
      vars: [
        "OWNER_ID:local-test-owner",
        "ENVIRONMENT:development",
        "ALLOW_LOCAL_DEV_IDENTITY:true",
        "DEV_OWNER_ID:local-test-owner",
      ],
    },
  ],
  testFile: "tests/e2e/run-obsidian.mjs",
});
