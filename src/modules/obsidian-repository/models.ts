import { z } from "zod";
import {
  directoryHandleSchema,
  presetSchema,
  presetPathsRefinement,
} from "../obsidian-local/contracts";
import { OBSIDIAN_WORKSPACE_LOCAL } from "../config/limits";
export const repositorySchema = z
  .object({
    id: z.uuid(),
    revision: z.uuid(),
    name: presetSchema.shape.vaultName,
    handle: directoryHandleSchema,
    identity: z.enum(["confirmed", "pending"]),
    isVault: z.boolean(),
  })
  .strict();
export type Repository = z.infer<typeof repositorySchema>;
export type RepositoryRoot = Pick<Repository, "name" | "handle">;
export const repositoryPresetSchema = z
  .object({
    id: z.uuid(),
    revision: z.uuid(),
    repositoryId: z.uuid(),
    name: presetSchema.shape.name,
    noteDirectory: presetSchema.shape.noteDirectory,
    imageRule: presetSchema.shape.imageRule,
  })
  .strict()
  .superRefine(presetPathsRefinement);
export type RepositoryPreset = z.infer<typeof repositoryPresetSchema>;
export type Workspace = {
  repositories: Repository[];
  presets: RepositoryPreset[];
};
export function repositoryLabel(repository: Repository) {
  return (
    repository.name +
    " · " +
    repository.id.slice(0, OBSIDIAN_WORKSPACE_LOCAL.labelIdLength)
  );
}
