import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readGeneratedArtifact } from "../../integrations/codex-harness/artifacts";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots.length = 0;
});
const png = new Uint8Array([
  137,
  80,
  78,
  71,
  13,
  10,
  26,
  10,
  ...new Array(24).fill(0),
]);
it("真实临时文件：只读取当前任务目录内普通图片，拒绝越界symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "harness-artifact-"));
  roots.push(root);
  const dir = join(root, "artifacts");
  await mkdir(dir);
  await writeFile(join(dir, "图 空格.png"), png);
  expect(
    (
      await readGeneratedArtifact(
        { status: "completed", savedPath: join(dir, "图 空格.png") },
        dir,
      )
    ).mime,
  ).toBe("image/png");
  await writeFile(join(root, "private.png"), png);
  await symlink(join(root, "private.png"), join(dir, "escape.png"));
  await expect(
    readGeneratedArtifact(
      { status: "completed", savedPath: join(dir, "escape.png") },
      dir,
    ),
  ).rejects.toMatchObject({ code: "UNSAFE_ARTIFACT" });
});
it("fileId不是任意下载URL；内联SVG/URL/伪造文字拒绝", async () => {
  await expect(
    readGeneratedArtifact(
      {
        status: "completed",
        fileId: "file-123",
        result: Buffer.from(png).toString("base64"),
      },
      "/tmp",
    ),
  ).rejects.toMatchObject({ code: "UNSUPPORTED_ARTIFACT" });
  for (const result of [
    "https://example.test/p.png",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "made image",
  ])
    await expect(
      readGeneratedArtifact({ status: "completed", result }, "/tmp"),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  expect(
    (
      await readGeneratedArtifact(
        { status: "completed", result: Buffer.from(png).toString("base64") },
        "/tmp",
      )
    ).mime,
  ).toBe("image/png");
});
