# 真实 Worker HTTP 测试

## 执行

先安装锁定依赖并构建，再运行测试：

```sh
npm ci
npm run build
npm run test:smoke
npm run test:worker
```

两条测试命令都会创建独立临时目录，自动对本地 D1 应用 `drizzle` 迁移，再启动构建后的 Astro Worker。无需手工建表或提前启动服务；不会复用开发数据库，也不会访问远程 D1/R2。必须保留 4321 端口，端到端测试还需要 4322；请串行执行这两条命令。

- `test:smoke`：真实 HTTP 首页及健康接口。
- `test:worker`：作者身份、创建文章、发布快照隔离、过期版本 409、有效 PNG 的本地 R2 上传下载、真实 R2 fixed/open/suffix 范围读取（206 字节和完整对象长度）、HEAD、416 与未授权访客不能探测私有长度、未配置模型返回 503、回收站恢复和独立访客身份。

作者身份仅注入本地开发实例。访客实例设置为 production，不注入作者身份。模型供应商未配置，测试不会发起付费模型请求。

运行器对迁移、启动和用例设置超时；成功、失败或收到 SIGINT/SIGTERM 时都会停止本次 Wrangler/workerd 进程组并删除本次临时目录。不会关闭其他应用或清理已有开发状态。

这是构建产物的 HTTP 测试，不等同于浏览器交互 E2E。浏览器测试见 `tests/e2e/README.md`。
