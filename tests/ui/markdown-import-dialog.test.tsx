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
it("快速连续选择和取消选择不丢文件；移除/替换只作用于指定附件", async () => {
  const upload = vi.fn(async (_file: File) => ({
      url: "/api/files/test-id",
      mime: "image/png",
    })),
    apply = vi.fn();
  render(
    <Dialog
      source={{
        file: new File(["note"], "note.md"),
        markdown: "![A](x.png)\n\n![B](y.png)",
      }}
      onClose={vi.fn()}
      upload={upload}
      apply={apply}
    />,
  );
  const picker = screen.getByLabelText("选择附件文件");
  await act(async () => {
    fireEvent.change(picker, { target: { files: [file()] } });
    fireEvent.change(picker, {
      target: { files: [new File(["B"], "y.png", { type: "image/png" })] },
    });
  });
  await act(async () => fireEvent.change(picker, { target: { files: [] } }));
  expect(screen.getAllByText("已匹配")).toHaveLength(2);
  fireEvent.click(screen.getByLabelText("移除 x.png"));
  expect(screen.getAllByText("已匹配")).toHaveLength(1);
  await act(async () =>
    fireEvent.change(picker, { target: { files: [file()] } }),
  );
  fireEvent.click(screen.getByLabelText("替换 x.png"));
  const replacement = new File(["new"], "new.png", { type: "image/png" });
  await act(async () =>
    fireEvent.change(screen.getByLabelText("替换已选附件"), {
      target: { files: [replacement] },
    }),
  );
  expect(screen.getAllByText("已匹配")).toHaveLength(2);
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "上传附件并导入" })),
  );
  expect(upload.mock.calls.map((call) => (call[0] as File).name)).toEqual([
    "new.png",
    "y.png",
  ]);
  expect(apply).toHaveBeenCalledOnce();
});
it("同名异图显示冲突和两份已选项，移除其中一份后才可导入", async () => {
  render(
    <Dialog
      source={source("A")}
      onClose={vi.fn()}
      upload={vi.fn()}
      apply={vi.fn()}
    />,
  );
  const a = file(),
    b = file();
  a.arrayBuffer = async () => new Uint8Array([1]).buffer;
  b.arrayBuffer = async () => new Uint8Array([2]).buffer;
  const picker = screen.getByLabelText("选择附件文件");
  await act(async () => fireEvent.change(picker, { target: { files: [a] } }));
  await act(async () => fireEvent.change(picker, { target: { files: [b] } }));
  expect(screen.getByText("同名待确认")).toBeTruthy();
  expect(screen.getAllByLabelText("移除 x.png")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "上传附件并导入" })).toBeNull();
  fireEvent.click(screen.getAllByLabelText("移除 x.png")[1]);
  expect(screen.getByText("已匹配")).toBeTruthy();
});
it("两张图分两次选择累加保留，原生文件按钮隐藏且允许一次多选", async () => {
  const source = {
    file: new File(["note"], "note.md"),
    markdown: "![A](x.png)\n\n![B](y.png)",
  };
  render(
    <Dialog
      source={source}
      onClose={vi.fn()}
      upload={vi.fn()}
      apply={vi.fn()}
    />,
  );
  const picker = screen.getByLabelText("选择附件文件") as HTMLInputElement;
  expect(picker.multiple).toBe(true);
  await act(async () => {
    await act(async () => {
      fireEvent.change(picker, { target: { files: [file()] } });
    });
    fireEvent.change(picker, {
      target: { files: [new File(["other"], "y.png", { type: "image/png" })] },
    });
  });
  expect(
    (
      screen.getByRole("button", {
        name: "上传附件并导入",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  expect(picker.hidden).toBe(true);
  expect(screen.getByText(/已识别 2 处附件引用/)).toBeTruthy();
});
it("无本地附件直接确认导入，不展示附件选择步骤", () => {
  render(
    <Dialog
      source={{ file: new File(["note"], "note.md"), markdown: "# 只有文字" }}
      onClose={vi.fn()}
      upload={vi.fn()}
      apply={vi.fn()}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "导入正文" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(screen.queryByRole("button", { name: "补充缺失附件" })).toBeNull();
});
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
  await act(async () => {
    fireEvent.change(screen.getByLabelText("选择附件文件"), {
      target: { files: [file()] },
    });
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
  await act(async () => {
    fireEvent.change(screen.getByLabelText("选择附件文件"), {
      target: { files: [file()] },
    });
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
  await act(async () => {
    fireEvent.change(screen.getByLabelText("选择附件文件"), {
      target: { files: [file()] },
    });
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "上传附件并导入" })),
  );
  expect(applyB).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
it("进度变化不重新解析或重新预检同一文档", async () => {
  const scan = vi.spyOn(attachments, "inspectAttachments");
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
  await act(async () => {
    fireEvent.change(screen.getByLabelText("选择附件文件"), {
      target: { files: [file()] },
    });
  });
  const scans = scan.mock.calls.length;
  expect(scans).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "上传附件并导入" }));
  expect(scan.mock.calls.length).toBe(scans);
  await act(async () => finish({ url: "/api/files/a-id", mime: "image/png" }));
  expect(scan.mock.calls.length).toBe(scans);
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
  await act(async () => {
    fireEvent.change(screen.getByLabelText("选择附件文件"), {
      target: { files: [file()] },
    });
  });
  fireEvent.click(screen.getByRole("button", { name: "上传附件并导入" }));
  fireEvent.click(screen.getByRole("button", { name: "取消导入" }));
  await act(async () => finish({ url: "/api/files/a-id", mime: "image/png" }));
  expect(apply).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
