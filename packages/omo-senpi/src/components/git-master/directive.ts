import type { OmoGitMasterSettings } from "@oh-my-opencode/omo-config-core"
import { buildGitAttributionDirective } from "@oh-my-opencode/skills-loader-core/opencode-skill-loader/git-master-template-injection"

export const DEFAULT_COMMIT_FOOTER = "Ultraworked with [omo](https://github.com/code-yeongyu/oh-my-openagent)"

export function buildGitMasterAttributionDirective(
  settings: OmoGitMasterSettings,
  gitCommandPrefix = "",
): string | undefined {
  return buildGitAttributionDirective(settings, gitCommandPrefix, DEFAULT_COMMIT_FOOTER)
}
