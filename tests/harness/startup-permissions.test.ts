import { afterEach, expect, it } from "vitest";
import { mkdtemp, chmod, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startLocalHarness } from "../../integrations/codex-harness/start";
let directory = "";
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
it("现有共享可写state目录在创建标记/认证文件/进程前拒绝", async () => {
  directory = await mkdtemp(join(tmpdir(), "harness-permission-"));
  await chmod(directory, 0o777);
  await expect(
    startLocalHarness([
      "--codex",
      "/nonexistent-codex-never-spawn",
      "--state-dir",
      directory,
    ]),
  ).rejects.toMatchObject({ code: "UNSAFE_DIRECTORY_PERMISSIONS" });
  expect(await readdir(directory)).toEqual([]);
});
