import { runLocalWorkerSuite } from "./local-worker-runner.mjs";
import { DEV_PORT, SECOND_PORT } from "./dev-config.mjs";
// 仅本地隔离夹具模拟可信分发器；不修改线上 Sites 或真实凭据。
await runLocalWorkerSuite({
  instances: [
    {
      name: "sites",
      port: DEV_PORT,
      vars: [
        "AUTH_MODE:sites",
        "OWNER_ID:isolated-sites-owner",
        "ENVIRONMENT:production",
      ],
    },
    {
      name: "unconfigured-password",
      port: SECOND_PORT,
      vars: ["AUTH_MODE:password", "ENVIRONMENT:production"],
    },
  ],
  testFile: "tests/worker/author-auth.mjs",
});
