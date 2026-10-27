interface LinkConfirmation {
  documentTarget: EventTarget;
  confirmLeave: () => boolean;
  currentUrl: () => string;
}

/** 表单页保持完整导航：链接显式确认，其余离开仍由浏览器原生保护。 */
export function installUnsavedGuard(
  windowTarget: EventTarget,
  links?: LinkConfirmation,
) {
  let confirmedLink = false;
  const beforeUnload = (event: Event) => {
    // 已明确确认的链接只放行本次卸载，避免再弹原生确认。
    if (confirmedLink) {
      confirmedLink = false;
      return;
    }
    event.preventDefault();
    // 兼容仍依赖 returnValue 的浏览器；提示文字由浏览器决定。
    (event as BeforeUnloadEvent).returnValue = "";
  };
  const resetConfirmation = () => {
    confirmedLink = false;
  };
  const beforeClick = (event: Event) => {
    const mouse = event as MouseEvent;
    if (
      event.defaultPrevented ||
      (mouse.button && mouse.button !== 0) ||
      mouse.metaKey ||
      mouse.ctrlKey ||
      mouse.shiftKey ||
      mouse.altKey
    )
      return;
    const element = event.composedPath()[0] ?? event.target;
    const link =
      element instanceof Element
        ? element.closest("a[href], area[href]")
        : null;
    if (!link || link.hasAttribute("download")) return;
    const target = link.getAttribute("target");
    if (target && target !== "_self") return;
    const href = link.getAttribute("href");
    if (!href || !links) return;
    let destination: URL;
    const current = new URL(links.currentUrl());
    try {
      destination = new URL(href, current);
    } catch {
      return;
    }
    if (!["https:", "http:"].includes(destination.protocol)) return;
    // 页内锚点不卸载文档，也不消耗一次确认。
    if (
      destination.origin === current.origin &&
      destination.pathname === current.pathname &&
      destination.search === current.search &&
      destination.hash
    )
      return;
    if (!links.confirmLeave()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    confirmedLink = true;
  };
  windowTarget.addEventListener("beforeunload", beforeUnload);
  windowTarget.addEventListener("pageshow", resetConfirmation);
  links?.documentTarget.addEventListener("click", beforeClick, true);
  return () => {
    windowTarget.removeEventListener("beforeunload", beforeUnload);
    windowTarget.removeEventListener("pageshow", resetConfirmation);
    links?.documentTarget.removeEventListener("click", beforeClick, true);
  };
}
