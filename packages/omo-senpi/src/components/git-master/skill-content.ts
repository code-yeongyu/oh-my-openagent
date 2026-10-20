import type { OmoGitMasterSettings } from "@oh-my-opencode/omo-config-core"
import { injectGitMasterConfig } from "@oh-my-opencode/skills-loader-core/opencode-skill-loader/git-master-template-injection"

import { buildGitMasterAttributionDirective } from "./directive"

// Senpi's bash tool always runs bash (Git Bash on Windows), whatever the user's login shell is,
// so the prefix must be the bash form; a csh/PowerShell form would be dropped by bash.
const SENPI_COMMAND_SHELL = "unix"

const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---\r?\n/

export interface GitMasterSkillAdditions {
  readonly rewriteSkillText: (text: string) => string
  readonly directive: string | undefined
}

function injectAfterFrontmatter(text: string, gitEnvPrefix: string): string {
  const frontmatter = FRONTMATTER_PATTERN.exec(text)?.[0] ?? ""
  const body = text.slice(frontmatter.length)
  const config = { commit_footer: false, git_env_prefix: gitEnvPrefix }
  return frontmatter + injectGitMasterConfig(body, config, SENPI_COMMAND_SHELL)
}

export function resolveGitMasterSkillAdditions(settings: OmoGitMasterSettings): GitMasterSkillAdditions | undefined {
  const gitEnvPrefix = settings.git_env_prefix
  const directive = buildGitMasterAttributionDirective(settings, gitEnvPrefix)
  if (gitEnvPrefix === "" && directive === undefined) return undefined
  return {
    rewriteSkillText: gitEnvPrefix === "" ? (text) => text : (text) => injectAfterFrontmatter(text, gitEnvPrefix),
    directive,
  }
}
