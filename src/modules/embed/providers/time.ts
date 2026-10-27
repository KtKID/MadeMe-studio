/** 解析 YouTube/Bilibili 常见的起始时间写法："90"、"90s"、"1m30s"、"1h2m3s"、"12.5"。无效值返回 undefined（忽略，不拒绝整条链接）。 */
export function parseStartSeconds(value: string | null): number | undefined {
  if (!value) return;
  const plain = /^(\d{1,6})(?:\.\d{1,3})?s?$/.exec(value);
  const parts = plain
    ? Number(plain[1])
    : (() => {
        const m = /^(?:(\d{1,2})h)?(?:(\d{1,3})m)?(?:(\d{1,5})s)?$/.exec(value);
        if (!m || !(m[1] || m[2] || m[3])) return undefined;
        return (
          Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
        );
      })();
  if (parts === undefined || !Number.isSafeInteger(parts) || parts <= 0) return;
  return parts <= 24 * 3600 ? parts : undefined;
}
