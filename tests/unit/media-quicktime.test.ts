import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import BlockReader from "../../src/components/content/BlockReader";
import { isQuickTime, validateMedia } from "../../src/server/media/service";
import {
  acceptedMediaMimeTypes,
  acceptedVideoFormatsLabel,
  MAX_MEDIA_BYTES,
  mediaUploadProblem,
} from "../../src/shared/contracts";

const fixture = new Uint8Array(
  readFileSync(new URL("../fixtures/screen-recording.mov", import.meta.url)),
);
/** 构造一个原子：4 字节大端长度 + 4 字节类型 + 填充。 */
function atom(type: string, size: number, total = size) {
  const b = new Uint8Array(Math.max(total, 16));
  new DataView(b.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
  return b;
}
const code = (fn: () => void) => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

describe("QuickTime（.mov）上传", () => {
  it("MIME 清单与文案来自同一处并包含 MOV", () => {
    expect(acceptedMediaMimeTypes).toContain("video/quicktime");
    expect(acceptedVideoFormatsLabel).toContain("MOV");
    expect(
      mediaUploadProblem({ size: 402 * 1024, type: "video/quicktime" }),
    ).toBeNull();
    expect(
      mediaUploadProblem({ size: MAX_MEDIA_BYTES + 1, type: "video/quicktime" })
        ?.reason,
    ).toBe("too_large");
    expect(
      mediaUploadProblem({ size: 1, type: "video/x-matroska" })?.message,
    ).toContain("MP4、WebM、MOV");
  });
  it("真实 ffmpeg 生成的 H.264 .mov（ftyp qt）通过签名校验", () => {
    expect(String.fromCharCode(...fixture.slice(8, 12))).toBe("qt  ");
    expect(isQuickTime(fixture)).toBe(true);
    expect(code(() => validateMedia(fixture, "video/quicktime"))).toBe("ok");
  });
  it("无 ftyp、以 moov / wide / mdat / free 开头的旧式 QuickTime 也接受", () => {
    expect(isQuickTime(atom("moov", 16))).toBe(true);
    expect(isQuickTime(atom("wide", 8, 16))).toBe(true);
    expect(isQuickTime(atom("mdat", 0, 16))).toBe(true);
    expect(isQuickTime(atom("mdat", 1, 16))).toBe(true);
    expect(isQuickTime(atom("free", 12, 16))).toBe(true);
  });
  it("拒绝伪装与畸形原子", () => {
    const png = new Uint8Array(
      readFileSync(new URL("../fixtures/valid-image.png", import.meta.url)),
    );
    expect(code(() => validateMedia(png, "video/quicktime"))).toBe(
      "MEDIA_SIGNATURE_MISMATCH",
    );
    expect(
      isQuickTime(new TextEncoder().encode("<html><script>x</script>")),
    ).toBe(false);
    expect(isQuickTime(atom("moov", 4))).toBe(false); // 长度小于原子头
    expect(isQuickTime(atom("moov", 9999, 16))).toBe(false); // 长度超过文件
    expect(isQuickTime(atom("free", 0))).toBe(false); // 只有 mdat 可用 0
    expect(isQuickTime(atom("evil", 16))).toBe(false);
    expect(isQuickTime(atom("ftyp", 8))).toBe(false); // ftyp 至少含品牌
    expect(isQuickTime(new Uint8Array(8))).toBe(false);
  });
  it("MP4 校验不受影响，25 MB 上限不变", () => {
    expect(code(() => validateMedia(fixture, "video/mp4"))).toBe("ok");
    expect(
      code(() =>
        validateMedia(new Uint8Array(MAX_MEDIA_BYTES + 1), "video/quicktime"),
      ),
    ).toBe("FILE_TOO_LARGE");
  });
  it("站内 .mov 媒体渲染为不带 type 的 <video src>（Chrome 对 video/quicktime 的 canPlayType 为空，加 type 会被跳过）", () => {
    const html = renderToStaticMarkup(
      createElement(BlockReader, {
        blocks: [
          {
            type: "video",
            props: { url: "/api/files/abc-123", name: "录屏.mov" },
          },
        ],
      }),
    );
    expect(html).toContain('<video src="/api/files/abc-123"');
    expect(html).not.toContain("<source");
    expect(html).not.toContain("type=");
  });
});
