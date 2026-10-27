# 内容检查模块（content-check）

保存 / 发布前“文章里哪一块有问题”的**唯一规则来源**。编辑器（保存前预检，不发请求）和服务端（`src/server/content/validation.ts`）用同一套规则、同一段中文提示，所以作者看到的原因与服务端 422 的原因完全一致。

纯函数，只依赖 `src/modules/embed`，Workers、浏览器、Node 测试都能运行。

## 导出

| 函数 / 类型                   | 作用                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `findContentProblems(blocks)` | 按文档顺序（含子块）扫描所有块的 `url` / `href` / `src` 与嵌入块，返回 `ContentProblem[]`                |
| `summarizeProblems(problems)` | 第一条原因 +“（另有 N 处问题）”，用作错误消息                                                            |
| `adviseVideoBlocks(blocks)`   | 视频块建议：`normalize`（YouTube/Bilibili 嵌入代码→规范链接）、`convert`（X 动态→改为嵌入块）、`invalid` |
| `isAllowedLink(key, value)`   | 链接白名单：`https:`、站内 `/api/files/<id>`，`href` 另允许 `mailto:`                                    |
| `blockLabel(type)`            | 块类型的中文名（视频块、图片块、段落……）                                                                 |

`ContentProblem` 字段：`code`（`UNSAFE_URL` / `UNSAFE_EMBED`）、`reason`（`unsafe_url` / `embed_snippet` / `unsupported_embed`）、`blockId`、`blockType`、`ordinal`（同类型的第几个，从 1 开始）、`field`、`message`（中文）。

## 提示示例

- 第 2 个视频块的地址不是视频文件或支持的平台链接：请上传视频，或粘贴 https:// 开头的视频直链、YouTube / Bilibili 视频页链接。
- 第 1 个视频块里粘贴的是 X 的嵌入代码，X 动态不是视频：请点提示里的“改为嵌入块”。
- 第 1 个嵌入块：暂不支持该网站……

## 服务端 422 形状

```json
{
  "error": {
    "code": "UNSAFE_URL",
    "message": "第 1 个视频块……",
    "details": {
      "problems": [
        {
          "reason": "embed_snippet",
          "blockType": "video",
          "ordinal": 1,
          "field": "url",
          "blockId": "…",
          "message": "…"
        }
      ]
    }
  }
}
```

最多返回 20 条。编辑器用 `problems[0].blockId` 滚动并高亮对应块。

## 日志

- 服务端：`content.rejected`（info），字段 `code`、`reason`、`blockType`、`ordinal`、`field`、`count`；嵌入块另有 `embed.rejected`（reason/host）。
- 编辑器：`editor.save_blocked`（warn），字段 `action`、`reason`、`blockType`、`ordinal`、`count`。
- **不记录 URL、嵌入代码或正文**。

## 测试

`tests/unit/content-check.test.ts`（规则、序号、服务端 422 与日志脱敏）、`tests/ui/editor-save-errors.test.tsx`（弹窗内显示与一键改为嵌入块）、`tests/worker/flow.mjs`（真实 Worker 422 形状）。
