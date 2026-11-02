import { HARD_MAX_UPLOAD_BYTES } from "../config/limits";
import { throwIfAborted } from "../../shared/request-cancellation";
import {
  inspectAttachments,
  type Attachment,
  type MediaReference,
} from "./attachments";

/** 分次选择只累加；仅对真正引用的同名/同大小文件比字节，不能误丢同名异图。 */
export async function appendSelectedAttachments(
  markdown: string,
  current: Attachment[],
  files: File[],
  signal?: AbortSignal,
) {
  const result = [...current];
  const read = async (file: File) => {
    const data = await file.arrayBuffer();
    throwIfAborted(signal);
    return new Uint8Array(data);
  };
  for (const file of files) {
    throwIfAborted(signal);
    const asset: Attachment = { path: file.name, file, explicit: true };
    const candidates = result.filter(
      (old) =>
        old.explicit && old.path === asset.path && old.file.size === file.size,
    );
    let duplicate = result.some((old) => old.file === file);
    // 不读取未被正文引用的文件；超限/不支持的文件交给现有预检明确拒绝。
    if (
      !duplicate &&
      candidates.length &&
      file.size <= HARD_MAX_UPLOAD_BYTES &&
      inspectAttachments(markdown, [asset], { mode: "selected" }).some(
        (row) => row.asset === asset,
      )
    ) {
      const data = await read(file);
      for (const old of candidates) {
        const previous = await read(old.file);
        if (
          data.length === previous.length &&
          data.every((value, index) => value === previous[index])
        ) {
          duplicate = true;
          break;
        }
      }
    }
    if (!duplicate) result.push(asset);
  }
  return result;
}

/** 只做展示分类，不抓远程内容；真正转块仍由 applyMediaKinds 和上传MIME决定。 */
export function referenceDetails(ref: MediaReference) {
  let name = ref.target.split(/[?#]/)[0].split("/").at(-1) || ref.target;
  if (!ref.wiki) {
    try {
      name = decodeURIComponent(name);
    } catch {
      /* 编码错误由匹配器展示 */
    }
  }
  const extension = name.split(".").at(-1)?.toLowerCase();
  const type =
    extension === "gif"
      ? "GIF 动图"
      : ["mp4", "webm", "mov"].includes(extension || "")
        ? "视频"
        : ["png", "jpg", "jpeg", "webp", "avif"].includes(extension || "")
          ? "图片"
          : ["mp3", "wav", "ogg", "m4a"].includes(extension || "")
            ? "音频"
            : extension === "pdf"
              ? "PDF"
              : "媒体";
  return {
    name,
    type,
    source: ref.target.startsWith("/api/files/")
      ? "本站媒体"
      : /^https:\/\//i.test(ref.target)
        ? "远程链接"
        : "本地文件",
  };
}
