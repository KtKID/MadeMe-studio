/**
 * 落库图（960 WebP）的命名约定：上传服务、展示衍生和存量迁移脚本共用，保持纯函数无运行时依赖。
 * 是否已转换只看 D1 行（mime + object_key），不依赖 R2 自定义元数据（wrangler CLI 无法写入）。
 */
export const storedImageKey = (id: string) => `media/${id}.webp`;
export const isStoredImage = (row: {
  id: string;
  mime: string;
  object_key: string;
}) => row.mime === "image/webp" && row.object_key === storedImageKey(row.id);
/** 落库后扩展名与内容一致：a.PNG → a.webp；无扩展名时追加。 */
export function webpName(name: string) {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  return `${base || "image"}.webp`;
}
