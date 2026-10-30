import { runLocalWorkerSuite } from "./local-worker-runner.mjs";
import { DEV_PORT } from "./dev-config.mjs";

// 独立临时 D1/R2；只创建本轮验收数据，退出时由运行器清理。
await runLocalWorkerSuite({
  instances: [
    {
      name: "home-e2e-owner",
      port: DEV_PORT,
      vars: [
        "OWNER_ID:local-test-owner",
        "ENVIRONMENT:development",
        "ALLOW_LOCAL_DEV_IDENTITY:true",
        "DEV_OWNER_ID:local-test-owner",
      ],
    },
  ],
  testFile: "tests/e2e/run-home.mjs",
});
