import { runLocalWorkerSuite } from "./local-worker-runner.mjs";
import { DEV_PORT } from "./dev-config.mjs";
await runLocalWorkerSuite({
  instances: [
    {
      name: "markdown-attachments-owner",
      port: DEV_PORT,
      vars: [
        "OWNER_ID:local-test-owner",
        "ENVIRONMENT:development",
        "ALLOW_LOCAL_DEV_IDENTITY:true",
        "DEV_OWNER_ID:local-test-owner",
      ],
    },
  ],
  testFile: "tests/e2e/run-markdown-attachments.mjs",
  suiteTimeout: 240_000,
});
