// 本地开发与本地测试的端口/地址唯一来源（对应 src/modules/config 的“部署/环境”层）。
// 修改端口：设置环境变量 DEV_PORT（例如 DEV_PORT=5000 npm run dev）；第二个测试实例使用 DEV_PORT+1。
// 只监听回环地址 127.0.0.1，开发身份开关不会暴露到局域网。
const raw = Number(process.env.DEV_PORT);
export const DEV_HOST = "127.0.0.1";
export const DEV_PORT =
  Number.isInteger(raw) && raw > 0 && raw < 65535 ? raw : 4321;
/** Worker 测试的第二个实例（访客 / 未配置密码）端口。 */
export const SECOND_PORT = DEV_PORT + 1;
export const devOrigin = (port = DEV_PORT) => `http://${DEV_HOST}:${port}`;
