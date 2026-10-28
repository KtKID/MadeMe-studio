import { expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import SaveButton from "../src/modules/obsidian-local/SaveButton";
it("SSR初始入口不访问document，也不创建portal或目录授权", () => {
  expect(typeof document).toBe("undefined");
  const html = renderToString(
    <SaveButton
      getSnapshot={() => ({
        articleId: "a",
        title: "测试",
        markdown: "",
        blocks: [],
      })}
    />,
  );
  expect(html).toContain("保存到 Obsidian");
  expect(html).not.toContain('role="dialog"');
});
