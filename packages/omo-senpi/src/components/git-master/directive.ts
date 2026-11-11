import type { OmoGitMasterSettings } from "@oh-my-opencode/omo-config-core"
import {
  CO_AUTHOR_TRAILER_INSTRUCTION,
  NO_CO_AUTHOR_INSTRUCTION,
  buildAttributedCommitExample,
} from "@oh-my-opencode/skills-loader-core/opencode-skill-loader/git-master-template-injection"
import { resolveGitAttribution, type GitAttributionCheckOptions } from "@oh-my-opencode/utils"

export const DEFAULT_COMMIT_FOOTER =
  "Ultraworked with [omo](https://github.com/code-yeongyu/oh-my-openagent)"

export const COMMIT_ATTRIBUTION_OPEN_TAG = "<commit_attribution>"

/**
 * Commit attribution: the `Co-authored-by: sisyphus-dev-ai` trailer is on by default
 * (`include_co_authored_by`) and the body footer is opt-in (`commit_footer`). Author and
 * committer stay the operator's own git identity. Returns `undefined` when both are off.
 * Env and Git-config overrides can suppress both, or turn the footer on.
 */
export function buildGitMasterAttributionDirective(
  settings: OmoGitMasterSettings,
  options: GitAttributionCheckOptions & { readonly gitCommandPrefix?: string } = {},
): string | undefined {
  const { gitCommandPrefix = "", ...attributionOptions } = options
  const resolved = resolveGitAttribution(settings, attributionOptions)
  const footerText = resolveFooterText(resolved.commitFooter)
  const includeCoAuthor = resolved.includeCoAuthoredBy
  if (footerText === undefined && !includeCoAuthor) return undefined

  const footerStep = footerText === undefined ? [] : [`1. **Footer in the commit body:** ${footerText}`, ""]
  const coAuthorStep = includeCoAuthor
    ? `${footerText === undefined ? 1 : 2}. ${CO_AUTHOR_TRAILER_INSTRUCTION}`
    : NO_CO_AUTHOR_INSTRUCTION

  return [
    COMMIT_ATTRIBUTION_OPEN_TAG,
    "## Commit Attribution (MANDATORY)",
    "",
    "Add omo attribution to EVERY commit you create:",
    "",
    ...footerStep,
    coAuthorStep,
    "",
    "**Example:**",
    "```bash",
    buildAttributedCommitExample(gitCommandPrefix, footerText, includeCoAuthor),
    "```",
    "</commit_attribution>",
  ].join("\n")
}

function resolveFooterText(footer: boolean | string): string | undefined {
  if (footer === false) return undefined
  return typeof footer === "string" ? footer : DEFAULT_COMMIT_FOOTER
}
