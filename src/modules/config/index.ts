/**
 * 配置模块（同构入口，可在浏览器使用）。服务端读取请用 `./server`，部署级环境请用 `./env`。
 */
export * from "./limits";
export * from "./endpoints";
export { DEFAULT_CONFIG } from "./defaults";
export * from "./schema";
export * from "./meta";
export * from "./public";
