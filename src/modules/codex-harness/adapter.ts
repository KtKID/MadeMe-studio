import {
  harnessTaskInputSchema,
  harnessTaskSchema,
  type HarnessTaskInput,
} from "../../../integrations/codex-harness/contracts";
/** 宿主注入已授权的传输；博客模块不知道 CLI、端口、认证文件或账户 token。 */
export interface HarnessTaskPort {
  submit(input: HarnessTaskInput): Promise<unknown>;
}
export type HarnessTaskOptions = Pick<HarnessTaskInput, "model"> &
  Partial<Pick<HarnessTaskInput, "mode" | "recordConsent">>;
export function createBlogHarnessAdapter(port: HarnessTaskPort) {
  async function submit(
    kind: HarnessTaskInput["kind"],
    input: string,
    requestId: string,
    options: HarnessTaskOptions,
  ) {
    const request = harnessTaskInputSchema.parse({ kind, input, requestId, ...options });
    const task = harnessTaskSchema.parse(await port.submit(request));
    if (task.requestId !== request.requestId || task.kind !== request.kind ||
      task.model !== request.model || task.mode !== request.mode)
      throw new Error("任务回执不匹配，请重新读取原任务状态。");
    return task;
  }
  return {
    polishSelection: (selection: string, requestId: string, options: HarnessTaskOptions) =>
      submit("polish-selection", selection, requestId, options),
    generateImage: (prompt: string, requestId: string, options: HarnessTaskOptions) =>
      submit("image-generation", prompt, requestId, options),
  };
}
/** 只提供待用户检查的建议；本适配器绝不自动写文章、上传媒体或发布。 */
export function readHarnessSuggestion(
  value: unknown,
):
  | { kind: "text"; text: string }
  | { kind: "image"; artifactId: string }
  | null {
  const task = harnessTaskSchema.parse(value);
  if (task.status !== "completed") return null;
  if (task.kind === "polish-selection" && task.result?.text?.trim())
    return { kind: "text", text: task.result.text };
  if (task.kind === "image-generation" && task.result?.artifactId)
    return { kind: "image", artifactId: task.result.artifactId };
  return null;
}
