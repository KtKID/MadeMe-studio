/**
 * 一次性存量迁移：把 R2 中尚未转换的静态位图原图（media/<id>）转成 960 宽 WebP 落库图
 * （media/<id>.webp），更新 D1 行，然后删除原图与旧衍生 image-derivatives/v1/<id>/（不含 s1/）。
 *
 * 用法（在仓库根目录；需要 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID 环境变量，脚本不打印它们）：
 *   npx tsx scripts/migrate-media-960.ts --config <wrangler.jsonc> --dry-run   只读：下载、本机转换、打印预期结果
 *   npx tsx scripts/migrate-media-960.ts --config <wrangler.jsonc> --apply     真实执行（先备份 + D1 导出）
 * 可选：--only <id>[,<id>]  --backup-dir <目录>（默认 /workspace/mm-deploy/media-backup-<日期>）
 *
 * 安全顺序（每张图）：备份原图并核对大小/sha256 → 本机转换 → 上传新键并回读核对 →
 * 条件 UPDATE（WHERE object_key=旧键）→ 删除旧原图与旧衍生。D1 更新失败会删掉刚上传的新键，原图不动。
 * 没有 --dry-run 或 --apply 时拒绝运行；重复运行是幂等的（已转换的行会跳过）。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  inspectRaster,
  STORE_CONVERTIBLE_MIME,
} from "../src/server/media/image-encoder";
import { AppError } from "../src/server/errors";
import {
  isStoredImage,
  storedImageKey,
  webpName,
} from "../src/server/media/stored-image";
import { MEDIA_FILENAME_MAX } from "../src/modules/config/limits";
import { encodeStoredImageNode, MIGRATION_LIMITS } from "./lib/node-codec";

type Row = {
  id: string;
  object_key: string;
  name: string;
  mime: string;
  size: number;
};
type Result = {
  id: string;
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  newSize?: number;
  newWidth?: number;
  newHeight?: number;
  orientation?: number;
  icc?: boolean;
  derivatives?: number;
  action: string;
};

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const dryRun = flag("--dry-run");
const apply = flag("--apply");
if (dryRun === apply) {
  console.error("必须且只能指定 --dry-run 或 --apply 之一。");
  process.exit(2);
}
const config = option("--config");
if (!config || !existsSync(config)) {
  console.error(
    "缺少 --config <wrangler.jsonc>（指向目标环境的 Wrangler 配置）。",
  );
  process.exit(2);
}
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!process.env.CLOUDFLARE_API_TOKEN || !accountId) {
  console.error(
    "缺少 CLOUDFLARE_API_TOKEN 或 CLOUDFLARE_ACCOUNT_ID 环境变量。",
  );
  process.exit(2);
}
const only = option("--only")?.split(",").filter(Boolean);
const date = new Date().toISOString().slice(0, 10);
const backupDir = resolve(
  option("--backup-dir") ??
    `/workspace/mm-deploy/media-backup-${date}${dryRun ? "-dryrun" : ""}`,
);
// JSONC：去掉注释后解析，只读取 D1 数据库名与 R2 桶名。
let wranglerConfig: {
  d1_databases?: { database_name?: string }[];
  r2_buckets?: { bucket_name?: string }[];
};
try {
  wranglerConfig = JSON.parse(
    readFileSync(config, "utf8")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,(\s*[}\]])/g, "$1"),
  );
} catch (error) {
  // 简易 JSONC 处理：字符串值里含 // 或 /* 会被误删，此时请改用无注释的 JSON 配置。
  console.error(
    `无法解析 ${config}：${(error as Error).message}（仅支持行注释/块注释，字符串内不能含 // 或 /*）。`,
  );
  process.exit(2);
}
const database = wranglerConfig.d1_databases?.[0]?.database_name ?? "";
const bucket = wranglerConfig.r2_buckets?.[0]?.bucket_name ?? "";
if (!database || !bucket) {
  console.error("Wrangler 配置中找不到 d1_databases[0] 或 r2_buckets[0]。");
  process.exit(2);
}

const ID = /^[0-9a-f-]{36}$/;
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const sql = (value: string | number) =>
  typeof value === "number" ? String(value) : `'${value.replace(/'/g, "''")}'`;

function wrangler(argv: string[]) {
  return execFileSync("npx", ["wrangler", ...argv, "-c", config!], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}
function d1(command: string) {
  const output = wrangler([
    "d1",
    "execute",
    database,
    "--remote",
    "--json",
    "--command",
    command,
  ]);
  // wrangler 偶尔会在 stdout 混入提示行：截取首个 "[" 到末个 "]"，解析失败则明确中止。
  const start = output.indexOf("["),
    end = output.lastIndexOf("]");
  let parsed: {
    results: Record<string, unknown>[];
    meta?: { changes?: number };
    success: boolean;
  }[];
  try {
    if (start < 0 || end < start) throw new Error("无 JSON 数组");
    parsed = JSON.parse(output.slice(start, end + 1));
  } catch (error) {
    throw new Error(
      `D1 输出无法解析（${(error as Error).message}），已中止：${command}`,
    );
  }
  if (!parsed[0]?.success) throw new Error(`D1 执行失败：${command}`);
  return parsed[0];
}
function r2Get(key: string, file: string) {
  wrangler([
    "r2",
    "object",
    "get",
    `${bucket}/${key}`,
    "--remote",
    "--file",
    file,
  ]);
  return new Uint8Array(readFileSync(file));
}
function r2Put(key: string, file: string, contentType: string) {
  wrangler([
    "r2",
    "object",
    "put",
    `${bucket}/${key}`,
    "--remote",
    "--file",
    file,
    "--content-type",
    contentType,
  ]);
}
function r2Delete(key: string) {
  wrangler(["r2", "object", "delete", `${bucket}/${key}`, "--remote"]);
}
/** wrangler CLI 没有 list；用 Cloudflare R2 REST 只读列举前缀（含未写入 manifest 的残留批次）。 */
async function r2List(prefix: string) {
  const keys: string[] = [];
  let cursor = "";
  do {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`,
    );
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("per_page", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    });
    const body = (await response.json()) as {
      success: boolean;
      result?: { key: string }[];
      result_info?: { cursor?: string; is_truncated?: boolean };
    };
    if (!response.ok || !body.success)
      throw new Error(`R2 列举失败 ${response.status}：${prefix}`);
    keys.push(...(body.result ?? []).map((o) => o.key));
    cursor = body.result_info?.is_truncated
      ? (body.result_info.cursor ?? "")
      : "";
  } while (cursor);
  return keys;
}

/** 旧衍生：image-derivatives/v1/<id>/ 下除 s1/ 以外的全部对象（含未写入 manifest 的残留批次）。 */
async function legacyDerivatives(id: string) {
  return (await r2List(`image-derivatives/v1/${id}/`)).filter(
    (key) => !key.startsWith(`image-derivatives/v1/${id}/s1/`),
  );
}
/** 已转换行残留的旧对象：原图 media/<id> 与旧衍生。 */
async function legacyKeys(id: string) {
  const original = (await r2List(`media/${id}`)).filter(
    (key) => key === `media/${id}`,
  );
  return [...original, ...(await legacyDerivatives(id))];
}

async function main() {
  // 备份含整库导出（会话/令牌哈希、未发布草稿），目录仅当前用户可读。
  mkdirSync(join(backupDir, "originals"), { recursive: true, mode: 0o700 });
  mkdirSync(join(backupDir, "converted"), { recursive: true, mode: 0o700 });
  chmodSync(backupDir, 0o700);
  console.log(
    `模式：${dryRun ? "dry-run（只读）" : "apply（真实写入）"}  D1=${database}  R2=${bucket}  目录=${backupDir}`,
  );
  if (apply) {
    // 先做整库导出，任何对象变更前完成；失败直接中止。
    const exportFile = join(backupDir, `d1-${database}-${Date.now()}.sql`);
    wrangler(["d1", "export", database, "--remote", "--output", exportFile]);
    console.log(`D1 导出完成：${exportFile}`);
  }
  const rows = d1(
    "SELECT id, object_key, name, mime, size FROM media ORDER BY created_at",
  ).results as Row[];
  const results: Result[] = [];
  let failures = 0;
  for (const row of rows) {
    if (only && !only.includes(row.id)) continue;
    const base: Result = {
      id: row.id,
      name: row.name,
      mime: row.mime,
      size: row.size,
      action: "",
    };
    try {
      if (!ID.test(row.id)) throw new Error("媒体 ID 格式异常");
      if (isStoredImage(row)) {
        // 已转换：检查上次是否有删除失败留下的旧原图/旧衍生，重跑时补删。
        const leftovers = await legacyKeys(row.id);
        if (!leftovers.length) {
          results.push({ ...base, action: "skip: 已是落库 WebP" });
          continue;
        }
        if (dryRun) {
          results.push({
            ...base,
            derivatives: leftovers.length,
            action: `would-cleanup: ${leftovers.length} 个旧对象`,
          });
          continue;
        }
        for (const key of leftovers) r2Delete(key);
        results.push({
          ...base,
          derivatives: leftovers.length,
          action: `cleanup: 删除 ${leftovers.length} 个旧对象`,
        });
        continue;
      }
      if (!(STORE_CONVERTIBLE_MIME as readonly string[]).includes(row.mime)) {
        results.push({ ...base, action: "skip: 非静态位图，保留原样" });
        continue;
      }
      if (row.object_key !== `media/${row.id}`)
        throw new Error(`对象键不符合约定：${row.object_key}`);
      const originalFile = join(backupDir, "originals", row.id);
      const original = r2Get(row.object_key, originalFile);
      if (original.length !== row.size)
        throw new Error(
          `原图大小 ${original.length} 与 D1 记录 ${row.size} 不一致`,
        );
      let info;
      try {
        info = inspectRaster(original, row.mime, MIGRATION_LIMITS);
      } catch (error) {
        if (error instanceof AppError && error.code === "IMAGE_PASSTHROUGH") {
          results.push({ ...base, action: "skip: 动画图，保留原样" });
          continue;
        }
        throw error;
      }
      const variant = await encodeStoredImageNode(original, info);
      const convertedFile = join(backupDir, "converted", `${row.id}.webp`);
      writeFileSync(convertedFile, variant.data);
      const derivatives = await legacyDerivatives(row.id);
      const result: Result = {
        ...base,
        width: info.width,
        height: info.height,
        newSize: variant.data.length,
        newWidth: variant.width,
        newHeight: variant.height,
        orientation: info.orientation,
        icc: info.icc,
        derivatives: derivatives.length,
        action: dryRun ? "would-convert" : "",
      };
      writeFileSync(
        join(backupDir, "originals", `${row.id}.json`),
        JSON.stringify(
          { ...row, sha256: sha256(original), derivatives },
          null,
          2,
        ),
      );
      if (dryRun) {
        results.push(result);
        continue;
      }
      const newKey = storedImageKey(row.id);
      r2Put(newKey, convertedFile, "image/webp");
      // 新键上传之后、D1 成功指向它之前的任何失败都撤回新键，原图与 D1 不动。
      try {
        const check = r2Get(newKey, `${convertedFile}.verify`);
        if (sha256(check) !== sha256(variant.data))
          throw new Error("新对象回读校验失败");
        const name = webpName(
          row.name.slice(0, MEDIA_FILENAME_MAX - ".webp".length),
        );
        const updated = d1(
          `UPDATE media SET object_key=${sql(newKey)}, mime='image/webp', size=${sql(variant.data.length)}, name=${sql(name)} WHERE id=${sql(row.id)} AND object_key=${sql(row.object_key)}`,
        );
        if (updated.meta?.changes !== 1)
          throw new Error("D1 行已被修改（条件更新 0 行），已撤回新对象");
      } catch (error) {
        r2Delete(newKey);
        throw error;
      }
      // D1 已指向新对象；此后才删除原图和旧衍生（备份已在本机）。
      // 删除失败不影响已完成的转换：标记 cleanup-failed，重跑脚本会补删。
      try {
        r2Delete(row.object_key);
        for (const key of derivatives) r2Delete(key);
        results.push({ ...result, action: "converted" });
      } catch (error) {
        failures++;
        results.push({
          ...result,
          action: `converted; cleanup-failed（重跑脚本补删）: ${(error as Error).message.split("\n")[0]}`,
        });
      }
    } catch (error) {
      failures++;
      results.push({
        ...base,
        action: `FAILED: ${(error as Error).message.split("\n")[0]}`,
      });
    }
  }
  writeFileSync(
    join(backupDir, `report-${dryRun ? "dryrun" : "apply"}.json`),
    JSON.stringify(results, null, 2),
  );
  const kb = (n?: number) =>
    n === undefined ? "-" : (n / 1024).toFixed(1) + "KB";
  console.log(
    "\n| id | 名称 | 类型 | 现大小 | 现尺寸 | 预期新大小 | 新尺寸 | 方向 | ICC | 旧衍生 | 动作 |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of results)
    console.log(
      `| ${r.id} | ${r.name} | ${r.mime} | ${kb(r.size)} | ${r.width ? `${r.width}×${r.height}` : "-"} | ${kb(r.newSize)} | ${r.newWidth ? `${r.newWidth}×${r.newHeight}` : "-"} | ${r.orientation ?? "-"} | ${r.icc === undefined ? "-" : r.icc ? "有" : "无"} | ${r.derivatives ?? "-"} | ${r.action} |`,
    );
  const before = results.reduce((s, r) => s + (r.newSize ? r.size : 0), 0);
  const after = results.reduce((s, r) => s + (r.newSize ?? 0), 0);
  console.log(
    `\n可转换 ${results.filter((r) => r.newSize).length} 张：${kb(before)} → ${kb(after)}；失败 ${failures} 张。`,
  );
  if (failures) process.exitCode = 1;
}
main().catch((error) => {
  console.error("迁移中止：", (error as Error).message);
  process.exitCode = 1;
});
