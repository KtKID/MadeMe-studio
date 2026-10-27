import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import type {
  D1Database,
  D1Result,
  D1Statement,
  R2Bucket,
  RuntimeEnv,
} from "../../src/server/runtime";
/** 用真实 SQLite 执行迁移和参数化 SQL，避免把数据库测试变成内存业务模拟。 */
export class SQLiteD1 implements D1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  constructor() {
    const directory = new URL("../../drizzle/", import.meta.url);
    for (const file of readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      this.sqlite.exec(readFileSync(new URL(file, directory), "utf8"));
    }
  }
  prepare(sql: string): D1Statement {
    let values: unknown[] = [];
    const self = this;
    return {
      bind(...args) {
        values = args;
        return this;
      },
      async first<T>(column?: string) {
        const row = self.sqlite
          .prepare(sql)
          .get(...(values as (string | number | null)[]));
        return (row ? (column ? row[column] : row) : null) as T | null;
      },
      async all<T>() {
        return {
          results: self.sqlite
            .prepare(sql)
            .all(...(values as (string | number | null)[])) as T[],
        };
      },
      async run() {
        const result = self.sqlite
          .prepare(sql)
          .run(...(values as (string | number | null)[]));
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }
  async batch(statements: D1Statement[]): Promise<D1Result[]> {
    this.sqlite.exec("BEGIN");
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.sqlite.close();
  }
}
/** R2 适配器只模拟对象存储边界；数据库仍使用真实 SQLite。 */
export class MemoryR2 implements R2Bucket {
  objects = new Map<string, Uint8Array>();
  async put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream,
  ) {
    let bytes: Uint8Array;
    if (value instanceof ReadableStream)
      bytes = new Uint8Array(await new Response(value).arrayBuffer());
    else if (ArrayBuffer.isView(value))
      bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    else bytes = new Uint8Array(value);
    this.objects.set(key, bytes.slice());
  }
  async head(key: string) {
    const bytes = this.objects.get(key);
    return bytes ? { size: bytes.length } : null;
  }
  async get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ) {
    const bytes = this.objects.get(key);
    const range = options?.range;
    const selected =
      bytes && range
        ? bytes.slice(range.offset, range.offset + range.length)
        : bytes;
    return bytes
      ? {
          body: new Response(selected!.slice().buffer).body!,
          size: bytes.length,
        }
      : null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}
export function fixtureEnv(): RuntimeEnv & { DB: SQLiteD1; BUCKET: MemoryR2 } {
  return {
    DB: new SQLiteD1(),
    BUCKET: new MemoryR2(),
    AUTH_MODE: "sites",
    OWNER_ID: "test-owner",
    SESSION_SECRET: "only-for-tests-not-a-runtime-credential-0000",
  };
}
export const blocks = [
  {
    type: "paragraph",
    props: {},
    content: [{ type: "text", text: "Original text", styles: {} }],
    children: [],
  },
];
