/** 同时保护整页离开与 Astro 客户端导航；卸载时移除监听，避免跨页残留。 */
export function installUnsavedGuard(
  target: EventTarget,
  confirmLeave: () => boolean,
  windowTarget: EventTarget = target,
) {
  const beforeUnload = (event: Event) => event.preventDefault();
  const beforeNavigation = (event: Event) => {
    if (!confirmLeave()) event.preventDefault();
  };
  windowTarget.addEventListener("beforeunload", beforeUnload);
  target.addEventListener("astro:before-preparation", beforeNavigation);
  return () => {
    windowTarget.removeEventListener("beforeunload", beforeUnload);
    target.removeEventListener("astro:before-preparation", beforeNavigation);
  };
}
