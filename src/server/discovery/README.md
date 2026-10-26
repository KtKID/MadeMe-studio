# 公开内容发现模块

RSS 与 sitemap 仅由公开发布快照生成，排除草稿、密码、链接访问、回收站内容。
XML 字符统一转义。作者是否登录不影响输出。实际路由在 src/pages。
验收：tests/unit/discovery.test.ts，先建立失败用例后实现。
