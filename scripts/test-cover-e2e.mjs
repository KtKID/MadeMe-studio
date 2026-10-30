import { runLocalWorkerSuite } from "./local-worker-runner.mjs";
import { DEV_PORT } from "./dev-config.mjs";
// 封面浏览器验收：全新临时 D1/R2 与明确测试身份，结束后清理；不连接生产数据，不调用真实生图。
await runLocalWorkerSuite({
  instances: [
    {
      name: "cover-e2e-owner",
      port: DEV_PORT,
      vars: [
        "OWNER_ID:local-test-owner",
        "ENVIRONMENT:development",
        "ALLOW_LOCAL_DEV_IDENTITY:true",
        "DEV_OWNER_ID:local-test-owner",
      ],
    },
  ],
  testFile: "tests/e2e/run-cover.mjs",
  suiteTimeout: 600_000,
});
