import type { OmoGitMasterSettings } from "@oh-my-opencode/omo-config-core"
import {
  COMMIT_ATTRIBUTION_OPEN_TAG,
  insertGitEnvPrefixBlock,
} from "@oh-my-opencode/skills-loader-core/opencode-skill-loader/git-master-template-injection"

import { buildGitMasterAttributionDirective } from "./directive"

// Senpi's bash tool always runs bash (Git Bash on Windows), whatever the user's login shell is,
// so the line form must be the bash form; a csh/PowerShell form would be dropped by bash.
const SENPI_COMMAND_SHELL = "unix"

export interface GitMasterSkillAdditions {
  readonly rewriteSkillText: (text: string) => string
  readonly directive: string | undefined
}

export function resolveGitMasterSkillAdditions(settings: OmoGitMasterSettings): GitMasterSkillAdditions | undefined {
  const gitEnvPrefix = settings.git_env_prefix
  const directive = buildGitMasterAttributionDirective(settings, gitEnvPrefix)
  if (gitEnvPrefix === "" && directive === undefined) return undefined
  return {
    rewriteSkillText:
      gitEnvPrefix === "" ? (text) => text : (text) => insertGitEnvPrefixBlock(text, gitEnvPrefix, SENPI_COMMAND_SHELL),
    directive,
  }
}

export function carriesAttributionDirective(texts: readonly string[]): boolean {
  return texts.some((text) => text.includes(COMMIT_ATTRIBUTION_OPEN_TAG))
}
