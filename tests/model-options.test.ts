import { describe, it, expect } from "vitest";
import { providerSchema } from "../src/shared/contracts";
import {
  providerLabels,
  normalizeImageModel,
} from "../src/components/settings/model-options";
describe("模型配置展示协议", () => {
  it("共享Zod支持的每个平台均有界面名称", () => {
    for (const kind of providerSchema.shape.kind.options)
      expect(providerLabels[kind]).toBeTruthy();
    expect(providerLabels.gemini).toBe("Google Gemini");
  });
  it("文本与图像模型独立，空白图像模型省略而非发送非法空串", () => {
    const input = { model: "text-model", imageModel: "   " };
    expect(normalizeImageModel(input)).toEqual({ model: "text-model" });
    expect(input.imageModel).toBe("   ");
    expect(
      normalizeImageModel({ model: "text-model", imageModel: " image-model " }),
    ).toEqual({ model: "text-model", imageModel: "image-model" });
  });
});
