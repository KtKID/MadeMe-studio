import { listWorkspace, getRepository } from "./store";
import type { PresetRecord } from "../obsidian-local/contracts";
import { repositoryLabel } from "./models";
export type ExportPreset = PresetRecord & {
  repositoryId: string;
  repositoryRevision: string;
  ruleRevision: string;
};
/** handle只在使用时按repositoryId解析，不存入每个预设。旧导出引擎协议保持。 */
export async function listExportPresets(): Promise<ExportPreset[]> {
  const state = await listWorkspace();
  return state.presets.map((rule) => {
    const repository = state.repositories.find(
      (r) => r.id === rule.repositoryId,
    )!;
    return {
      repositoryId: repository.id,
      repositoryRevision: repository.revision,
      ruleRevision: rule.revision,
      handle: repository.handle,
      preset: {
        id: rule.id,
        name: repositoryLabel(repository) + " / " + rule.name,
        vaultName: repository.name,
        isVault: repository.isVault,
        noteDirectory: rule.noteDirectory,
        imageRule: rule.imageRule,
      },
    };
  });
}
export async function assertExportPresetCurrent(
  record: PresetRecord | ExportPreset,
) {
  if (!("repositoryId" in record)) return; // 显式“其他位置”是本次临时目标，不是已保存预设。
  const current = await getRepository(record.repositoryId);
  if (!current || current.revision !== record.repositoryRevision)
    throw new Error("所属仓库已变化或删除，尚未保存，请重新选择目标。 ");
  const state = await listWorkspace(),
    rule = state.presets.find((p) => p.id === record.preset.id);
  if (
    !rule ||
    rule.repositoryId !== record.repositoryId ||
    rule.revision !== record.ruleRevision
  )
    throw new Error("保存预设已变化或删除，请重新选择。 ");
}
