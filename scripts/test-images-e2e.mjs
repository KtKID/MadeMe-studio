import { runLocalWorkerSuite } from "./local-worker-runner.mjs";
import { DEV_PORT, SECOND_PORT } from "./dev-config.mjs";
await runLocalWorkerSuite({
  instances: [
    {
      name: "images-owner",
      port: DEV_PORT,
      vars: [
        "OWNER_ID:local-test-owner",
        "ENVIRONMENT:development",
        "ALLOW_LOCAL_DEV_IDENTITY:true",
        "DEV_OWNER_ID:local-test-owner",
      ],
    },
    {
      name: "images-guest",
      port: SECOND_PORT,
      vars: ["ENVIRONMENT:production"],
    },
  ],
  testFile: "tests/e2e/run-images.mjs",
});
