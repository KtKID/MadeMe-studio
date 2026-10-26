import { runLocalWorkerSuite } from "./local-worker-runner.mjs";

// 冒烟同样从空数据库启动，只测试无身份访客，不保留守护进程。
await runLocalWorkerSuite({
  instances: [{ name: "smoke", port: 4321, vars: ["ENVIRONMENT:production"] }],
  testFile: "tests/smoke/http.mjs",
});
