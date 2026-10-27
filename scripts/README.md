# 工程脚本

- `run-astro.mjs`：设置进程级缓存与日志位置后运行 Astro，不修改宿主全局配置。
- `package-worker.mjs`：保留 Astro 原始入口，生成托管兼容入口。
- `local-worker-runner.mjs`：从全新临时 D1/R2 应用本地迁移，启动构建产物，管理超时并清理本次进程与临时存储。
- `smoke-local.mjs`：无身份访客实例的真实 HTTP 冒烟入口。
- `test-worker.mjs`：独立作者/访客实例的完整 HTTP 流程入口。
- `vite/`：托管集成插件，第三方许可证保留。

## 验证顺序

```sh
npm run build
npm run test:smoke
npm run test:worker
```

后两条命令自动建表及启动服务，必须串行执行并预留回环端口 DEV_PORT / DEV_PORT+1（默认 4321/4322，唯一来源 `dev-config.mjs`），不需提前启动开发服务；不会使用远程数据库或复用开发存储。详见 [Worker 测试](../tests/worker/README.md)。浏览器 E2E 的执行条件与结果另见 [浏览器测试](../tests/e2e/README.md)。

- `test-author-auth-worker.mjs`：构建后通过 `node scripts/test-author-auth-worker.mjs` 运行隔离认证回归；不配置真实凭据，不等同生产身份分发或 HTTPS 浏览器验收。
