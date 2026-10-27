/**
 * 统一日志模块入口。三个文件均只依赖 Web 标准 API（console、crypto.randomUUID），
 * 可在 Workers、浏览器与 Node 测试中运行；业务代码优先按运行端导入具体文件：
 * 服务端 `./server`，浏览器 `./client`，脱敏规则 `./redact`。
 */
export {
  log,
  logger,
  logCaught,
  requestLogContext,
  configureLogLevel,
  currentLogLevel,
  type LogLevel,
  type LogFields,
  type RequestLogContext,
} from "./server";
export { clientLog, clientCaught, type ClientLogLevel } from "./client";
export {
  redact,
  scrubString,
  serializeError,
  isSensitiveKey,
  REDACTED,
  SAFE_CODE,
  type SerializedError,
} from "./redact";
