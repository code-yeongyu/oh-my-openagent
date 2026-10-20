import * as z from "zod"

import type { OmoHarnessId } from "./harness"

const GIT_ENV_ASSIGNMENT_PATTERN =
  /^(?:[A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9_-]*)(?: [A-Za-z_][A-Za-z0-9_]*=[A-Za-z0-9_-]*)*$/

const GitEnvPrefixSchema = z
  .string()
  .refine((value) => value === "" || GIT_ENV_ASSIGNMENT_PATTERN.test(value), {
    message: 'git_env_prefix must be empty or use shell-safe env assignments like "GIT_MASTER=1"',
  })

const OmoGitMasterSettingsShape = {
  /** Opt in to an attribution footer in commit bodies (default: false). `true` uses the builtin footer text; a string replaces it. */
  commit_footer: z.union([z.boolean(), z.string()]),
  /** @deprecated No-op kept for backward compatibility; omo never emits a Co-authored-by trailer. */
  include_co_authored_by: z.boolean(),
  /** Env assignments prefixed to every git command git-master runs, so git hooks can detect it (default: "GIT_MASTER=1"; "" disables). */
  git_env_prefix: GitEnvPrefixSchema,
}

export const OmoGitMasterSettingsLayerSchema = z.object(OmoGitMasterSettingsShape).partial().strict()

export const OmoGitMasterSettingsSchema = OmoGitMasterSettingsLayerSchema.extend({
  commit_footer: z.union([z.boolean(), z.string()]).default(false),
  include_co_authored_by: z.boolean().default(false),
  git_env_prefix: GitEnvPrefixSchema.default("GIT_MASTER=1"),
}).strict()

export type OmoGitMasterSettings = z.infer<typeof OmoGitMasterSettingsSchema>
export type OmoGitMasterSettingsLayer = z.infer<typeof OmoGitMasterSettingsLayerSchema>

export interface OmoGitMasterConfigView {
  readonly git_master?: OmoGitMasterSettings
}

type GitMasterSettingKey = keyof OmoGitMasterSettings
type GitMasterSettingPath = `git_master.${GitMasterSettingKey}`

export const GIT_MASTER_HARNESS_SUPPORT: Record<GitMasterSettingPath, readonly OmoHarnessId[]> = {
  "git_master.commit_footer": ["native"],
  "git_master.include_co_authored_by": ["native"],
  "git_master.git_env_prefix": ["native"],
} as const

/** Resolve the effective git-master attribution settings, applying defaults when the section is absent. */
export function resolveOmoGitMasterSettings(config: OmoGitMasterConfigView): OmoGitMasterSettings {
  return config.git_master ?? OmoGitMasterSettingsSchema.parse({})
}
