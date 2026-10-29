// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConfigSection } from "../../src/components/settings/ConfigSection";
import { resolveConfig } from "../../src/modules/config";
afterEach(cleanup);

it.each([
  ["media", "upload", "disabledTypes", "允许上传的文件类型", "取消勾选的格式"],
  ["reading", "reading", "disabledEmbeds", "允许的嵌入平台", "取消勾选后"],
] as const)(
  "%s 勾选=允许，文案与禁用列表的反向绑定一致",
  (tab, group, key, title, hint) => {
    const onChange = vi.fn();
    const config = resolveConfig({});
    render(
      <ConfigSection
        tab={tab}
        config={config}
        problems={{}}
        onChange={onChange}
      />,
    );
    const fieldset = screen.getByRole("group", {
      name: `${title}（勾选 = 允许）`,
    });
    expect(fieldset.textContent).toContain(hint);
    const checkbox = fieldset.querySelector("input")!;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    const changed = onChange.mock.lastCall![0];
    expect(changed[group][key]).toHaveLength(1);
    cleanup();
    render(
      <ConfigSection
        tab={tab}
        config={changed}
        problems={{}}
        onChange={onChange}
      />,
    );
    const disabled = screen
      .getByRole("group", { name: `${title}（勾选 = 允许）` })
      .querySelector("input")!;
    expect(disabled.checked).toBe(false);
    fireEvent.click(disabled);
    expect(onChange.mock.lastCall![0][group][key]).toEqual([]);
  },
);
