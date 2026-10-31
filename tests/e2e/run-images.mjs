import { spawn } from "node:child_process";
const child = spawn(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "tests/e2e/image-delivery.spec.ts",
    "tests/e2e/media.spec.ts",
    "--workers=1",
  ],
  { stdio: "inherit", env: process.env },
);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
