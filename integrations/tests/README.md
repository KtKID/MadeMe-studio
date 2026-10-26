# 集成测试

## 自动化

```sh
node --test integrations/tests/*.node.mjs
node integrations/chrome-clipper/build.mjs
node integrations/obsidian-publisher/esbuild.config.mjs
node integrations/agent-publisher/publish.mjs --help
```

覆盖安全 origin、Token 格式、换行/字节限制、与主 Zod 协议一致性、草稿不可被覆盖、固定 API、Cookie/重定向禁用、错误脱敏、独立版本化发布、MV3 权限、CLI 单文件/dry-run 冒烟。Mock fetch 不联系真实站点。

最小回执回归覆盖仅写 Token 的草稿/发布、完整 Post 的兼容与摘要脱敏、畸形混合回执拒绝；客户端直接复用共同 `postMutationResponseSchema`，不要求正文和 `posts:read`。该安全更新先测出旧实现 4 项失败，适配后全套 19 项通过。

`transport.e2e.node.mjs` 进一步启动真实 CLI 子进程和回环 HTTP 夹具，检查从单文件到请求再到输出的完整传输，以及 307 重定向不会收到 Token。这是**本地协议 E2E**，不等于完整 Astro/D1 应用或真实扩展/Obsidian 的端到端验证。

开发顺序：shared/Chrome 首版先写实现；新增 TDD 要求后先补此测试，再开发 CLI/Obsidian。测试状态以实际命令结果为准，不声明未执行的 E2E 已通过。

## 人工 E2E 验收（需要用户授权的测试站点与测试 Token）

真实 CLI → Astro/D1 API 的可执行步骤、授权门槛、期望结果与清理见 [LIVE_API_E2E.md](LIVE_API_E2E.md)。本地 HTTP 夹具保留为每次开发可安全运行的回归测试。

1. 新建仅 `posts:write` 的测试 Token；三种入口均能创建草稿，公开列表/RSS/search 不出现它；在 Studio 可见并可编辑 BlockNote 内容。
2. Chrome：全新 profile 中加载构建目录，取消站点授权不发送；允许仅目标主机，选区预览后保存；再次点击不会重复发送；变更站点清空 Token；Forget 后本地设置/授权移除。
3. Chrome：无选区/超长选区/输入框选区/内置页面；取消或关闭弹窗后检查 Studio 是否落库，不用自动重试掩盖未知结果。
4. Obsidian：专用测试 vault 只有当前笔记被读取；含未保存编辑时预览一致；取消不发送；确认后只发一次；重启后 Token 消失；图片/双链目标没有上传。
5. CLI：dry-run 无网络；单文件草稿成功；无 `--confirm-publish` 拒绝发布；只写 Token 无法发布；明确版本发布成功，过期版本返回 409。
6. 网络：401/403/413/429/服务器非 JSON/超时/跨站重定向均给可操作错误，不输出 Token，不自动重试；Cookie 登录状态不替代 Bearer 权限。
7. 审阅所有内容再在 Studio 发布；撤销测试 Token，确认三种入口均不能继续写入。

尚未具备真实 Token、Chrome 和 Obsidian 运行环境时，以上为待执行清单，而非通过记录。
