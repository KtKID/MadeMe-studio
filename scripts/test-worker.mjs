import { runLocalWorkerSuite } from "./local-worker-runner.mjs";
import { DEV_PORT, SECOND_PORT } from "./dev-config.mjs";

// 作者与访客实例共用本次临时数据库，但身份配置完全隔离。
await runLocalWorkerSuite({
  instances: [
    {
      name: "owner",
      port: DEV_PORT,
      vars: [
        "OWNER_ID:local-test-owner",
        "ENVIRONMENT:development",
        "ALLOW_LOCAL_DEV_IDENTITY:true",
        "DEV_OWNER_ID:local-test-owner",
      ],
    },
    { name: "reader", port: SECOND_PORT, vars: ["ENVIRONMENT:production"] },
  ],
  testFile: "tests/worker/flow.mjs",
});
