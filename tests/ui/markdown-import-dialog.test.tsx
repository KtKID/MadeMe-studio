// @vitest-environment jsdom
import { afterEach, it, expect, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as attachments from "../../src/modules/markdown-import/attachments";
import Dialog from "../../src/modules/markdown-import/ImportDialog";
vi.mock("../../src/modules/log/client", () => ({
  clientCaught: vi.fn(),
  clientLog: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const source = (name: string) => ({
  file: new File(["note"], name + ".md"),
  markdown: `![${name}](x.png)`,
});
const file = () => new File(["synthetic"], "x.png", { type: "image/png" });
it("附件失败不是Error时显示明确提示，保留窗口与输入", async () => {
  const close = vi.fn(),
    apply = vi.fn();
  render(
    <Dialog
      source={source("A")}
      onClose={close}
      upload={async () => {
        throw "offline";
      }}
      apply={apply}
    />,
  );
  fireEvent.change(screen.getByLabelText("选择附件文件"), {
    target: { files: [file()] },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "上传附件并导入" })),
  );
  expect(screen.getByText(/导入未完成/).textContent).not.toContain("undefined");
  expect(screen.getByText(/导入未完成/).textContent).toContain("附件处理失败");
  expect(close).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
});
it("切到新来源会取消旧上传，迟到结果不应用、不关闭新窗口；新来源可继续导入", async () => {
  let finish!: (value: attachments.UploadedAttachment) => void;
  let firstSignal: AbortSignal | undefined;
  const applyA = vi.fn(),
    applyB = vi.fn(),
    close = vi.fn();
  const upload = vi.fn((_file: File, signal?: AbortSignal) => {
    firstSignal = signal;
    return new Promise<attachments.UploadedAttachment>((resolve) => {
      finish = resolve;
    });
  });
  const a = source("A"),
    b = source("B");
  const view = render(
    <Dialog source={a} onClose={close} upload={upload} apply={applyA} />,
  );
  fireEvent.change(screen.getByLabelText("选择附件文件"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "上传附件并导入" }));
  view.rerender(
    <Dialog
      source={b}
      onClose={close}
      upload={async () => ({ url: "/api/files/b-id", mime: "image/png" })}
      apply={applyB}
    />,
  );
  expect(firstSignal?.aborted).toBe(true);
  await act(async () => finish({ url: "/api/files/a-id", mime: "image/png" }));
  expect(applyA).not.toHaveBeenCalled();
  expect(applyB).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("选择附件文件"), {
    target: { files: [file()] },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "上传附件并导入" })),
  );
  expect(applyB).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
it("进度变化不重新解析或重新预检同一文档", async () => {
  const scan = vi.spyOn(attachments, "mediaReferences"),
    plan = vi.spyOn(attachments, "attachmentPlan");
  let finish!: (value: attachments.UploadedAttachment) => void;
  const input = source("A");
  const view = render(
    <Dialog
      source={input}
      onClose={() => {}}
      upload={() =>
        new Promise((resolve) => {
          finish = resolve;
        })
      }
      apply={async () => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("选择附件文件"), {
    target: { files: [file()] },
  });
  const scans = scan.mock.calls.length,
    plans = plan.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "上传附件并导入" }));
  expect(scan.mock.calls.length).toBe(scans);
  expect(plan.mock.calls.length).toBe(plans);
  await act(async () => finish({ url: "/api/files/a-id", mime: "image/png" }));
  expect(scan.mock.calls.length).toBe(scans);
  expect(plan.mock.calls.length).toBe(plans);
  view.unmount();
});
it("取消后迟到的上传不应用，关闭只执行一次", async () => {
  let finish!: (value: attachments.UploadedAttachment) => void;
  const apply = vi.fn(),
    close = vi.fn();
  render(
    <Dialog
      source={source("A")}
      onClose={close}
      upload={() =>
        new Promise((resolve) => {
          finish = resolve;
        })
      }
      apply={apply}
    />,
  );
  fireEvent.change(screen.getByLabelText("选择附件文件"), {
    target: { files: [file()] },
  });
  fireEvent.click(screen.getByRole("button", { name: "上传附件并导入" }));
  fireEvent.click(screen.getByRole("button", { name: "取消导入" }));
  await act(async () => finish({ url: "/api/files/a-id", mime: "image/png" }));
  expect(apply).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
