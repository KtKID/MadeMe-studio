import { useStudioPane } from "../studio-navigation/pane";
import { useEffect } from "react";
import { markReady, installPerformance } from "./browser";
import type { StudioRoute } from "./protocol";
/** 数据加载结束后在 React 提交阶段通知，不以骨架或 URL 变化冒充完成。 */
export function useNavigationReady(
  path: StudioRoute,
  ready = true,
  failed = false,
) {
  const { active, navigationKey } = useStudioPane();
  useEffect(() => {
    installPerformance();
    if (active && ready) markReady(path, failed);
  }, [path, ready, failed, active, navigationKey]);
}
