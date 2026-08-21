import type { OmoGitMasterSettings } from "@oh-my-opencode/omo-config-core"

export const SISYPHUS_CO_AUTHOR_TRAILER =
  "Co-authored-by: sisyphus-dev-ai <sisyphus-dev-ai@users.noreply.github.com>"

export const DEFAULT_COMMIT_FOOTER =
  "Ultraworked with [omo](https://github.com/code-yeongyu/oh-my-openagent)"

export function buildGitMasterAttributionDirective(settings: OmoGitMasterSettings): string | undefined {
  const footerText = resolveFooterText(settings.commit_footer)
  const includeCoAuthor = settings.include_co_authored_by
  if (footerText === undefined && !includeCoAuthor) return undefined

  const attributions: string[] = []
  if (footerText !== undefined) attributions.push(`**Footer in the commit body:** ${footerText}`)
  if (includeCoAuthor) attributions.push(`**Co-authored-by trailer:** ${SISYPHUS_CO_AUTHOR_TRAILER}`)

  const exampleParts = [`git commit -m "{Commit Message}"`]
  if (footerText !== undefined) exampleParts.push(`-m "${footerText}"`)
  if (includeCoAuthor) exampleParts.push(`-m "${SISYPHUS_CO_AUTHOR_TRAILER}"`)

  return [
    "<commit_attribution>",
    "## Commit Footer & Co-Author (MANDATORY)",
    "",
    "Add omo attribution to EVERY commit you create:",
    "",
    ...attributions.map((attribution, index) => `${index + 1}. ${attribution}`),
    "",
    "**Example:**",
    "```bash",
    exampleParts.join(" "),
    "```",
    "</commit_attribution>",
  ].join("\n")
}

function resolveFooterText(footer: OmoGitMasterSettings["commit_footer"]): string | undefined {
  if (footer === false) return undefined
  return typeof footer === "string" ? footer : DEFAULT_COMMIT_FOOTER
}
