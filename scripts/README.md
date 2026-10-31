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
- `test-obsidian-e2e.mjs`：新建一次性作者 Worker/D1/R2，调用本地已安装 Playwright 的 Obsidian 保存页面用例，再清理测试进程和数据。原生浏览器启动/授权失败必须单列，不自动安装或绕过权限。

## 存量媒体转 960 WebP（一次性）

`migrate-media-960.ts`（`lib/node-codec.ts` 为 Node 版编码器，与 Worker 共用 `src/server/media/raster-codec.ts`）把尚未转换的静态 PNG/JPEG/WebP 原图转成 `media/<id>.webp`，更新 D1 行，然后删除原图与旧衍生 `image-derivatives/v1/<id>/`（不含新的 `s1/`）。视频、GIF、动画图跳过。本机内存充足，像素上限用 `IMAGE_MIGRATION_*`。

```sh
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...   # 脚本不打印凭据
npx tsx scripts/migrate-media-960.ts --config <目标 wrangler.jsonc> --dry-run   # 只读
npx tsx scripts/migrate-media-960.ts --config <目标 wrangler.jsonc> --apply     # 真实执行
```

- 必须先部署认识 `media/<id>.webp` 的新 Worker，再 `--apply`；在访问低峰执行：D1 改指新对象到删除旧对象之间，正在走旧衍生路径的在途请求可能短暂 503（前端回退到 `/api/files` 自愈）。
- 默认备份目录是部署机上的 `/workspace/mm-deploy/`，其他环境请用 `--backup-dir` 指定。
- `--apply` 先 `wrangler d1 export` 整库到备份目录（默认 `/workspace/mm-deploy/media-backup-<日期>/`），再逐张：下载原图并核对大小与 sha256 → 本机转换 → 上传新键并回读校验 → 条件 `UPDATE … WHERE object_key=旧键` → 删除原图和旧衍生。D1 更新失败或 0 行时撤回新对象，原图不动。
- 原图、转换结果、每张图的 sha256/旧衍生键清单和 `report-*.json` 都留在备份目录；可用 `--only <id>` 先试一张。重复运行幂等（已转换行跳过）。
- R2 列举使用 Cloudflare REST 只读接口（wrangler CLI 没有 list），对象读写删除使用 `wrangler r2 object`。
