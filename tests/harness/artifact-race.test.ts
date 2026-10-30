import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const race = vi.hoisted(() => ({ target: "", outside: "", armed: false }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  async function swap() {
    if (!race.armed) return;
    race.armed = false;
    await actual.unlink(race.target);
    await actual.symlink(race.outside, race.target);
  }
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      const info = await actual.stat(...args);
      await swap();
      return info;
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      const old = file.stat.bind(file);
      Object.defineProperty(file, "stat", {
        value: async () => {
          const info = await old();
          await swap();
          return info;
        },
      });
      return file;
    },
  };
});
import { readGeneratedArtifact } from "../../integrations/codex-harness/artifacts";
let root = "";
afterEach(async () => {
  race.armed = false;
  if (root) await rm(root, { recursive: true, force: true });
});
it("检查后路径被替换成越界链接时不得读取外部图片", async () => {
  root = await mkdtemp(join(tmpdir(), "harness-race-"));
  const dir = join(root, "artifacts");
  await mkdir(dir);
  race.target = join(dir, "a.png");
  race.outside = join(root, "outside.jpg");
  await writeFile(
    race.target,
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Array(24).fill(0)]),
  );
  await writeFile(race.outside, new Uint8Array([255, 216, 255, 224]));
  race.armed = true;
  const result = await readGeneratedArtifact(
    { status: "completed", savedPath: race.target },
    dir,
  ).then(
    (image) => ({ mime: image.mime, code: "" }),
    (error) => ({ mime: "", code: error.code }),
  );
  expect(result.mime === "image/png" || result.code === "UNSAFE_ARTIFACT").toBe(
    true,
  );
});
