# 保存预设边界重新验证仓库（2026-10-28）

## 确定遗漏

上次仅在两个 Browse 入口检查直属 `.obsidian`，但编辑旧记录直接进入确认保存时，`save()` 仍直接调用 `putPreset`。旧 `isVault` 值无法证明当前目录有效，Browse 后目录标记也可能变化。用户确认截图来自预览站；截图显示 TechNote 旧预设，但没有证据证明其实际标记存在性，因此不把本机状况当作已检查。

## 先红后绿

先写“旧预设不 Browse 直接确认”和“Browse 后标记消失”测试，运行：

```sh
./node_modules/.bin/vitest run tests/ui/obsidian-local.test.tsx -t '旧预设未重新Browse|Browse通过后标记被移除'
```

修改实现前：2 failed / 36 skipped，日志 `/tmp/obsidian-confirm-root-red.log`。回报红证据后才实现。

确认按钮进入 busy 锁后、`putPreset` 前重新执行 `verifyVault(pending.handle)`；没有标记显示既定重新选择提示，权限/IO错误保留错误处理。验证成功才保存 `isVault:true`。不申请文件写权限、不删除旧记录、不改名称或目录输入；取消确认后可以重新选目录。无新增配置或弹窗，不扫描子目录，不改文章保存位置。

新增 5 项覆盖历史 `isVault` true/false、标记消失、权限/IO错误与重新选择有效目录；更新旧测试区分“拒绝的新目录”和“仍有效的原目录”，重复确认依然只写一次。

## 验证与范围

全仓 82 文件 / 672 项通过；check 240 文件，0 errors / 0 warnings / 5 既有 hints；build 和 HTTP smoke 通过。业务工作树不推送、不部署；仅按授权将修复同步独立预览 checkout，发布由父任务负责。未访问用户 Mac 或实际 vault，原生目录读取仍需现场验收。
