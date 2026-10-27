/** 站内导航先征求作者确认；真正刷新/关页仍保留原生安全网。 */
export function createEditorLeaveGuard(options: {
  isDirty: () => boolean;
  isBusy: () => boolean;
  show: (open: boolean) => void;
}) {
  let pending: (() => void) | undefined;
  let allowUnload = false;
  return {
    request(action: () => void) {
      if (options.isBusy() || pending) return;
      if (!options.isDirty()) {
        action();
        return;
      }
      pending = action;
      options.show(true);
    },
    cancel() {
      pending = undefined;
      options.show(false);
    },
    confirm() {
      if (!pending || options.isBusy()) return;
      const action = pending;
      pending = undefined;
      options.show(false);
      // 此标记不清理草稿，仅放行作者已明确批准的本次导航。
      allowUnload = true;
      try {
        action();
      } catch (error) {
        allowUnload = false;
        throw error;
      }
    },
    shouldBlockUnload() {
      if (allowUnload) {
        allowUnload = false;
        return false;
      }
      return options.isDirty() || options.isBusy();
    },
    reset() {
      allowUnload = false;
      pending = undefined;
      options.show(false);
    },
  };
}

/** 仅截获当前标签的同源文档链接，下载/新窗口/锚点交回浏览器。 */
export function editorLinkDestination(event: MouseEvent, currentHref: string) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const element = event.composedPath()[0] ?? event.target;
  const link =
    element instanceof Element ? element.closest("a[href], area[href]") : null;
  if (!link || link.hasAttribute("download")) return;
  const target = link.getAttribute("target");
  if (target && target !== "_self") return;
  const href = link.getAttribute("href");
  if (!href) return;
  const current = new URL(currentHref);
  let next: URL;
  try {
    next = new URL(href, current);
  } catch {
    return;
  }
  if (
    next.origin !== current.origin ||
    !["https:", "http:"].includes(next.protocol)
  )
    return;
  if (
    next.pathname === current.pathname &&
    next.search === current.search &&
    (next.hash || current.hash)
  )
    return;
  return next.href;
}
