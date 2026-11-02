import { spawn } from "node:child_process";
// 原生OPFS句柄测试与普通上传测试隔离浏览器生命周期；所有测试都运行，无跳过。
async function run(filters) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "tests/e2e/markdown-attachments.spec.ts",
        "tests/e2e/obsidian-repositories.spec.ts",
        "--workers=1",
        ...filters,
      ],
      { stdio: "inherit", env: process.env },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Markdown浏览器测试退出：${code}`)),
    );
  });
}
await run(["--grep-invert", "@native-handles"]);
// 原生文件能力保留完整trace，便于定位OS/OPFS边界；不改变任何断言。
await run(["--grep", "@native-handles", "--trace", "on"]);
