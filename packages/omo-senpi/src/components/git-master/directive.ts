import type { OmoGitMasterSettings } from "@oh-my-opencode/omo-config-core"
import { resolveGitAttribution, type GitAttributionCheckOptions } from "@oh-my-opencode/utils"

export const DEFAULT_COMMIT_FOOTER =
  "Ultraworked with [omo](https://github.com/code-yeongyu/oh-my-openagent)"

/**
 * Commit-identity contract: commits our tooling causes in a user's repository carry the
 * operator's own author/committer and never a GitHub-resolvable automation identity. The
 * directive therefore only ever describes the opt-in body footer; `include_co_authored_by`
 * is accepted for backward compatibility but no longer emits a `Co-authored-by` trailer.
 * Env and Git-config overrides can still suppress or re-enable the footer.
 */
export function buildGitMasterAttributionDirective(
  settings: OmoGitMasterSettings,
  options?: GitAttributionCheckOptions,
): string | undefined {
  const resolved = resolveGitAttribution(settings, options)
  const footerText = resolveFooterText(resolved.commitFooter)
  if (footerText === undefined) return undefined

  return [
    "<commit_attribution>",
    "## Commit Footer (MANDATORY)",
    "",
    "Add omo attribution to EVERY commit you create:",
    "",
    `1. **Footer in the commit body:** ${footerText}`,
    "",
    "Do NOT add a Co-authored-by trailer.",
    "",
    "**Example:**",
    "```bash",
    `git commit -m "{Commit Message}" -m "${footerText}"`,
    "```",
    "</commit_attribution>",
  ].join("\n")
}

function resolveFooterText(footer: boolean | string): string | undefined {
  if (footer === false) return undefined
  return typeof footer === "string" ? footer : DEFAULT_COMMIT_FOOTER
}
