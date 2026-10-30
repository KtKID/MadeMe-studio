/** 唯一公开测试样本；只允许录制这些非私人内容，不能当任意文章缓存。 */
export const PUBLIC_TEST_INPUTS = {
  "polish-selection":
    "这是一段公开测试文字。今天阳光很好，我们整理书桌，准备开始写作。",
  "image-generation":
    "生成一张用于公开测试的图片：白色背景上的黄色圆形，不要文字、人物或个人信息。",
} as const;
export const HARNESS_PROTOCOL_VERSION = "codex-app-server-v2@0.166.0-alpha.1";
