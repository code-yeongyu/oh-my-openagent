import * as z from "zod"

import type { OmoHarnessId } from "./harness"

const OmoGitMasterSettingsShape = {
  /** Add an attribution footer to commit messages (default: true). `true` uses the builtin footer text; a string replaces it. */
  commit_footer: z.union([z.boolean(), z.string()]),
  /** Add the "Co-authored-by: sisyphus-dev-ai" trailer to commit messages (default: true). */
  include_co_authored_by: z.boolean(),
}

export const OmoGitMasterSettingsLayerSchema = z.object(OmoGitMasterSettingsShape).partial().strict()

export const OmoGitMasterSettingsSchema = OmoGitMasterSettingsLayerSchema.extend({
  commit_footer: z.union([z.boolean(), z.string()]).default(true),
  include_co_authored_by: z.boolean().default(true),
}).strict()

export type OmoGitMasterSettings = z.infer<typeof OmoGitMasterSettingsSchema>
export type OmoGitMasterSettingsLayer = z.infer<typeof OmoGitMasterSettingsLayerSchema>

export interface OmoGitMasterConfigView {
  readonly git_master?: OmoGitMasterSettings
}

type GitMasterSettingKey = keyof OmoGitMasterSettings
type GitMasterSettingPath = `git_master.${GitMasterSettingKey}`

export const GIT_MASTER_HARNESS_SUPPORT: Record<GitMasterSettingPath, readonly OmoHarnessId[]> = {
  "git_master.commit_footer": ["senpi"],
  "git_master.include_co_authored_by": ["senpi"],
} as const

/** Resolve the effective git-master attribution settings, applying defaults when the section is absent. */
export function resolveOmoGitMasterSettings(config: OmoGitMasterConfigView): OmoGitMasterSettings {
  return config.git_master ?? OmoGitMasterSettingsSchema.parse({})
}
