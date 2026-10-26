/** 只有当前配置下已解码并绘制的图像能导出，防止空白画布与过期加载误报成功。 */
export class CropRenderGuard {
  private currentKey: string | null = null;
  private drawnKey: string | null = null;
  private width = 0;
  private height = 0;
  begin(key: string) {
    this.currentKey = key;
    this.drawnKey = null;
    this.width = 0;
    this.height = 0;
  }
  drawn(key: string, width: number, height: number) {
    if (
      key !== this.currentKey ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    )
      return false;
    this.drawnKey = key;
    this.width = width;
    this.height = height;
    return true;
  }
  failed(key: string) {
    if (key === this.currentKey) this.drawnKey = null;
  }
  canExport(key: string) {
    return (
      this.currentKey === key &&
      this.drawnKey === key &&
      this.width > 0 &&
      this.height > 0
    );
  }
  assertReady(key: string) {
    if (!this.canExport(key))
      throw new Error("图片尚未成功载入或当前裁剪尚未绘制，不能导出。");
  }
}
export function cropGeometry(
  width: number,
  height: number,
  ratio: number,
  zoom: number,
  x: number,
  y: number,
) {
  if (width <= 0 || height <= 0 || !Number.isFinite(width + height))
    throw new Error("图片尺寸无效。");
  const r = ratio > 0 ? ratio : width / height;
  const scale = Math.max(1, zoom);
  let sw = width / scale,
    sh = sw / r;
  if (sh > height / scale) {
    sh = height / scale;
    sw = sh * r;
  }
  return {
    sx: ((width - sw) * Math.max(0, Math.min(x, 100))) / 100,
    sy: ((height - sh) * Math.max(0, Math.min(y, 100))) / 100,
    sw,
    sh,
    width: 1200,
    height: Math.round(1200 / r),
  };
}
