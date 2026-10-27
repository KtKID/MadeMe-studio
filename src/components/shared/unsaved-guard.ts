/** 表单页禁用客户端路由，统一由浏览器原生离开确认保护未保存输入。 */
export function installUnsavedGuard(windowTarget: EventTarget) {
  const beforeUnload = (event: Event) => {
    event.preventDefault();
    // 兼容仍依赖 returnValue 的浏览器；提示文字由浏览器决定。
    (event as BeforeUnloadEvent).returnValue = "";
  };
  windowTarget.addEventListener("beforeunload", beforeUnload);
  return () => windowTarget.removeEventListener("beforeunload", beforeUnload);
}
