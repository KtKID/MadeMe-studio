import { createContext, useContext } from "react";
/** 不含业务数据；独立编辑器内未提供context时沿用原生命周期。 */
export const StudioPaneContext = createContext({
  active: true,
  navigationKey: 0,
});
export const useStudioPane = () => useContext(StudioPaneContext);
