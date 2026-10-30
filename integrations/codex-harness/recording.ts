import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, lstat, open, link, unlink } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { z } from "zod";
import {
  harnessTaskKindSchema,
  harnessTaskInputSchema,
  harnessModelSchema,
} from "./contracts";
import { HarnessError } from "./errors";
import { readGeneratedArtifact, type Artifact } from "./artifacts";
import {
  PUBLIC_TEST_INPUTS,
  HARNESS_PROTOCOL_VERSION,
} from "./recording/public-samples";
export {
  PUBLIC_TEST_INPUTS,
  HARNESS_PROTOCOL_VERSION,
} from "./recording/public-samples";
const MAX_FILE = 32 * 1024 * 1024;
const normalize = (value: string) =>
  value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const requestSchema = z.object({
  kind: harnessTaskKindSchema,
  input: z.string().max(20_000),
  model: harnessModelSchema,
  requestId: harnessTaskInputSchema.shape.requestId.optional(),
  mode: z.enum(["replay", "record"]).optional(),
  recordConsent: z.boolean().optional(),
});
type RecordingRequest = z.input<typeof requestSchema>;
const statusSchema = z.enum(["completed", "failed", "cancelled"]);
const eventSchema = z
  .object({
    type: z.enum([
      "started",
      "text-delta",
      "text-completed",
      "image-completed",
      "completed",
      "failed",
      "cancelled",
    ]),
    atMs: z.number().int().min(0).max(3_600_000),
    text: z.string().max(200_000).optional(),
  })
  .strict();
const associatedEventSchema = eventSchema
  .extend({
    taskId: z.string().min(1).max(200),
    threadId: z.string().min(1).max(200),
    turnId: z.string().min(1).max(200),
  })
  .strict();
const resultSchema = z.object({ text: z.string().max(200_000) }).strict();
const errorSchema = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/),
    message: z.string().max(1000),
  })
  .strict();
const snapshotSchema = z
  .object({
    taskId: z.string().min(1).max(200),
    threadId: z.string().min(1).max(200),
    turnId: z.string().min(1).max(200),
    status: statusSchema,
    events: z.array(associatedEventSchema).min(2).max(5000),
    result: resultSchema.optional(),
    error: errorSchema.optional(),
    artifact: z
      .object({
        bytes: z.instanceof(Uint8Array),
        mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
      })
      .strict()
      .optional(),
  })
  .strict();
export type RecordingSnapshot = z.infer<typeof snapshotSchema>;
const artifactSchema = z
  .object({
    mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
    base64: z.string().max(28_000_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const payloadSchema = z
  .object({
    version: z.literal(1),
    protocolVersion: z.string().min(1).max(200),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    kind: harnessTaskKindSchema,
    model: z.string(),
    status: statusSchema,
    events: z.array(eventSchema).min(2).max(5000),
    result: resultSchema.optional(),
    error: errorSchema.optional(),
    artifact: artifactSchema.optional(),
  })
  .strict();
const envelopeSchema = z
  .object({
    payload: payloadSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type RecordingResult = {
  status: z.infer<typeof statusSchema>;
  events: z.infer<typeof eventSchema>[];
  result?: z.infer<typeof resultSchema>;
  error?: z.infer<typeof errorSchema>;
  artifact?: Artifact;
};
const sensitive =
  /https?:\/\/auth\.openai\.com(?:[\/:?#]|$)|https?:\/\/(?:chatgpt\.com|chat\.openai\.com)\/(?:auth|oauth)(?:[\/?#]|$)|authorization\s*[:=]|bearer\s+\S+|sk-[a-zA-Z0-9_-]{8,}|(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token)\s*[:=]|\/(?:Users|home|workspace|tmp|var|Volumes|private|opt|etc)\/|[A-Za-z]:\\|~\/|[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/i;
export function assertRecordingSafe(
  value: unknown,
  secrets: readonly string[] = [],
) {
  const text = JSON.stringify(value);
  if (
    sensitive.test(text) ||
    secrets.some(
      (secret) =>
        secret.length > 0 &&
        (text.includes(secret) ||
          text.includes(JSON.stringify(secret).slice(1, -1))),
    )
  )
    throw new HarnessError(
      "RECORDING_SENSITIVE",
      "测试结果包含敏感信息，未保存回放样本。",
      422,
    );
}
function complete(
  kind: z.infer<typeof harnessTaskKindSchema>,
  value: RecordingResult,
) {
  const events = value.events;
  if (
    events.reduce((total, event) => total + (event.text?.length ?? 0), 0) >
    1_000_000
  )
    throw new HarnessError("RECORDING_TOO_LARGE", "录制文字超过限制。", 413);
  if (
    events.some(
      (e) =>
        ["text-delta", "text-completed"].includes(e.type) !==
        (typeof e.text === "string"),
    )
  )
    throw new HarnessError("RECORDING_INCOMPLETE", "文字事件格式不完整。", 422);
  const deltas = events.filter((e) => e.type === "text-delta");
  if (
    deltas.length &&
    value.status === "completed" &&
    deltas.map((e) => e.text).join("") !== value.result?.text
  )
    throw new HarnessError(
      "RECORDING_INCOMPLETE",
      "增量文字与最终结果不匹配。",
      422,
    );
  if (
    events[0]?.type !== "started" ||
    events.at(-1)?.type !== value.status ||
    events.some(
      (event, index) => index > 0 && event.atMs < events[index - 1].atMs,
    ) ||
    events
      .slice(0, -1)
      .some((event) =>
        ["completed", "failed", "cancelled"].includes(event.type),
      )
  )
    throw new HarnessError(
      "RECORDING_INCOMPLETE",
      "录制事件不完整，未生成可回放样本。",
      422,
    );
  if (value.status === "completed") {
    if (value.error)
      throw new HarnessError(
        "RECORDING_INCOMPLETE",
        "成功结果含错误状态。",
        422,
      );
    if (
      kind === "polish-selection" &&
      (!value.result?.text.trim() ||
        events.filter((e) => e.type === "text-completed").at(-1)?.text !==
          value.result.text ||
        value.artifact)
    )
      throw new HarnessError(
        "RECORDING_INCOMPLETE",
        "文字结果与完成事件不匹配。",
        422,
      );
    if (
      kind === "image-generation" &&
      (!value.artifact ||
        !events.some((e) => e.type === "image-completed") ||
        value.result)
    )
      throw new HarnessError("RECORDING_INCOMPLETE", "缺少真实图片结果。", 422);
  } else if (value.result || value.artifact)
    throw new HarnessError(
      "RECORDING_INCOMPLETE",
      "未完成任务不能附带成功产物。",
      422,
    );
}
/** 只读回放不接收 RPC/client，也不联网、启动进程或执行媒体副作用。 */
export class HarnessRecorder {
  private reservations = new Set<string>();
  constructor(
    private directory: string,
    private protocolVersion = HARNESS_PROTOCOL_VERSION,
  ) {
    if (!/^[a-zA-Z0-9@._:-]{1,200}$/.test(protocolVersion))
      throw new HarnessError("RECORDING_PROTOCOL", "协议版本无效。");
    if (!isAbsolute(directory))
      throw new HarnessError(
        "RECORDING_DIRECTORY",
        "录制目录须为专用绝对路径。",
      );
  }
  private identity(raw: RecordingRequest) {
    const input = requestSchema.parse(raw);
    const text = normalize(input.input);
    if (text !== normalize(PUBLIC_TEST_INPUTS[input.kind]))
      throw new HarnessError(
        "PUBLIC_TEST_ONLY",
        "只允许录制或回放界面展示的公开测试样本。",
        422,
      );
    const requestHash = hash(
      JSON.stringify({
        kind: input.kind,
        input: text,
        model: input.model,
        protocolVersion: this.protocolVersion,
      }),
    );
    return { input, requestHash };
  }
  private async privateDirectory() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const info = await lstat(this.directory);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (process.getuid && info.uid !== process.getuid()) ||
      (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    )
      throw new HarnessError(
        "RECORDING_DIRECTORY",
        "录制目录必须由当前用户独占。",
        403,
      );
  }
  /** 真实任务前原子占位；已有样本或未知执行占位一律阻止重新付费。 */
  async begin(raw: RecordingRequest) {
    const { input, requestHash } = this.identity(raw);
    if (input.mode !== "record" || input.recordConsent !== true)
      throw new HarnessError(
        "RECORDING_CONSENT_REQUIRED",
        "需要明确点击真实运行并录制。",
        422,
      );
    await this.privateDirectory();
    try {
      await lstat(join(this.directory, requestHash + ".json"));
      throw new HarnessError(
        "RECORDING_EXISTS",
        "该测试已有录制，请使用回放。",
        409,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    let handle;
    try {
      handle = await open(
        join(this.directory, requestHash + ".pending"),
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      await handle.writeFile(
        JSON.stringify({ requestHash, protocolVersion: this.protocolVersion }),
      );
      try {
        await lstat(join(this.directory, requestHash + ".json"));
        await handle.close();
        handle = undefined;
        await unlink(join(this.directory, requestHash + ".pending"));
        throw new HarnessError(
          "RECORDING_EXISTS",
          "该测试已有录制，请使用回放。",
          409,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      this.reservations.add(requestHash);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST")
        throw new HarnessError(
          "RECORDING_PENDING",
          "该测试存在未确认执行记录，不会再次调用模型。",
          409,
        );
      throw e;
    } finally {
      await handle?.close();
    }
  }
  async record(
    raw: RecordingRequest,
    rawSnapshot: RecordingSnapshot,
    secrets: readonly string[] = [],
  ): Promise<void> {
    const { input, requestHash } = this.identity(raw);
    const snapshot = snapshotSchema.parse(rawSnapshot);
    if (
      snapshot.events.some(
        (e) =>
          e.taskId !== snapshot.taskId ||
          e.threadId !== snapshot.threadId ||
          e.turnId !== snapshot.turnId,
      )
    )
      throw new HarnessError(
        "RECORDING_INCOMPLETE",
        "录制事件不属于同一任务。",
        422,
      );
    const events = snapshot.events.map(
      ({ taskId: _task, threadId: _thread, turnId: _turn, ...event }) => event,
    );
    const value: RecordingResult = {
      status: snapshot.status,
      events,
      ...(snapshot.result ? { result: snapshot.result } : {}),
      ...(snapshot.error ? { error: snapshot.error } : {}),
      ...(snapshot.artifact ? { artifact: snapshot.artifact } : {}),
    };
    complete(input.kind, value);
    assertRecordingSafe(
      events
        .filter((event) => event.type === "text-delta")
        .map((event) => event.text ?? "")
        .join(""),
      secrets,
    );
    assertRecordingSafe(
      { model: input.model, events, result: value.result, error: value.error },
      secrets,
    );
    let artifact: z.infer<typeof artifactSchema> | undefined;
    if (value.artifact) {
      if (
        secrets.some(
          (secret) =>
            secret.length > 0 &&
            Buffer.from(value.artifact!.bytes).includes(Buffer.from(secret)),
        )
      )
        throw new HarnessError(
          "RECORDING_SENSITIVE",
          "测试图片包含敏感信息，未保存回放样本。",
          422,
        );
      assertRecordingSafe(
        Buffer.from(value.artifact.bytes).toString("latin1"),
        secrets,
      );
      const checked = await readGeneratedArtifact(
        {
          status: "completed",
          result: Buffer.from(value.artifact.bytes).toString("base64"),
        },
        this.directory,
      );
      if (checked.mime !== value.artifact.mime)
        throw new HarnessError("RECORDING_INCOMPLETE", "图片格式不匹配。", 422);
      artifact = {
        mime: checked.mime,
        base64: Buffer.from(checked.bytes).toString("base64"),
        sha256: hash(checked.bytes),
      };
    }
    const payload = payloadSchema.parse({
      version: 1,
      protocolVersion: this.protocolVersion,
      requestHash,
      kind: input.kind,
      model: input.model,
      status: value.status,
      events,
      ...(value.result ? { result: value.result } : {}),
      ...(value.error ? { error: value.error } : {}),
      ...(artifact ? { artifact } : {}),
    });
    const serialized = JSON.stringify({
      payload,
      sha256: hash(JSON.stringify(payload)),
    });
    if (Buffer.byteLength(serialized) > MAX_FILE)
      throw new HarnessError("RECORDING_TOO_LARGE", "录制样本超过限制。", 413);
    if (!this.reservations.has(requestHash)) await this.begin(raw);
    const temporary = join(this.directory, "." + randomUUID() + ".tmp");
    try {
      const file = await open(
        temporary,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(serialized);
        await file.sync();
      } finally {
        await file.close();
      }
      try {
        await link(temporary, join(this.directory, requestHash + ".json"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new HarnessError(
            "RECORDING_EXISTS",
            "该测试已有录制，未覆盖原样本。",
            409,
          );
        throw error;
      }
      await unlink(temporary);
      await unlink(join(this.directory, requestHash + ".pending"));
      this.reservations.delete(requestHash);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }
  async replay(raw: RecordingRequest): Promise<RecordingResult> {
    const { input, requestHash } = this.identity(raw);
    const path = join(this.directory, requestHash + ".json");
    let file;
    try {
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        throw new HarnessError(
          "REPLAY_NOT_FOUND",
          "没有匹配录制；不会自动调用真实模型。",
          404,
        );
      throw new HarnessError(
        "RECORDING_CORRUPT",
        "无法安全读取录制样本。",
        422,
      );
    }
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_FILE) throw Error("size");
      const bytes = Buffer.alloc(MAX_FILE + 1);
      let total = 0;
      while (total < bytes.length) {
        const part = await file.read(bytes, total, bytes.length - total, null);
        if (!part.bytesRead) break;
        total += part.bytesRead;
      }
      if (total > MAX_FILE) throw Error("size");
      const saved = envelopeSchema.parse(
        JSON.parse(bytes.subarray(0, total).toString("utf8")),
      );
      const p = saved.payload;
      if (
        saved.sha256 !== hash(JSON.stringify(p)) ||
        p.requestHash !== requestHash ||
        p.protocolVersion !== this.protocolVersion ||
        p.kind !== input.kind ||
        p.model !== input.model
      )
        throw Error("integrity");
      let artifact: Artifact | undefined;
      if (p.artifact) {
        assertRecordingSafe(
          Buffer.from(p.artifact.base64, "base64").toString("latin1"),
          [],
        );
        artifact = await readGeneratedArtifact(
          { status: "completed", result: p.artifact.base64 },
          this.directory,
        );
        if (
          hash(artifact.bytes) !== p.artifact.sha256 ||
          artifact.mime !== p.artifact.mime
        )
          throw Error("artifact");
      }
      const value: RecordingResult = {
        status: p.status,
        events: p.events,
        ...(p.result ? { result: p.result } : {}),
        ...(p.error ? { error: p.error } : {}),
        ...(artifact ? { artifact } : {}),
      };
      complete(input.kind, value);
      assertRecordingSafe(
        value.events
          .filter((event) => event.type === "text-delta")
          .map((event) => event.text ?? "")
          .join(""),
        [],
      );
      assertRecordingSafe(
        { events: value.events, result: value.result, error: value.error },
        [],
      );
      return value;
    } catch {
      throw new HarnessError(
        "RECORDING_CORRUPT",
        "录制样本损坏或不完整，不会调用真实模型。",
        422,
      );
    } finally {
      await file.close();
    }
  }
}
