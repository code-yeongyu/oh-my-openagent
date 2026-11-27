import type { GitMasterConfig } from "../../types"
import { assertValidGitEnvPrefix } from "../../config/git-env-prefix"
import { detectShellType, buildEnvPrefix, type ShellType } from "../../shared/shell-env"

const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---\r?\n/

export const GIT_ENV_PREFIX_OPEN_TAG = "<git_env_prefix>"
export const COMMIT_ATTRIBUTION_OPEN_TAG = "<commit_attribution>"

/**
 * Parse a bash-format env prefix string ("VAR=value VAR2=value2") into a Record.
 * Only handles simple KEY=VALUE pairs (no quoting needed since assertValidGitEnvPrefix
 * already validates the format is shell-safe alphanumeric assignments).
 */
export function parseBashEnvPrefix(prefix: string): Record<string, string> {
  const result: Record<string, string> = {}
  const pairs = prefix.trim().split(/\s+/)
  for (const pair of pairs) {
    const eqIndex = pair.indexOf("=")
    if (eqIndex === -1) continue
    const key = pair.slice(0, eqIndex)
    const value = pair.slice(eqIndex + 1)
    result[key] = value
  }
  return result
}

/**
 * Build the shell-aware command prefix for git commands.
 * Uses the shared shell detection and env prefix builder to emit correct syntax
 * for PowerShell ($env:VAR='value';), cmd (set VAR="value" &&),
 * csh (setenv VAR value;), or unix (VAR=value).
 *
 * For unix shells, we use the inline VAR=value prefix style (not export) to match
 * the original behavior where the env var applies only to the immediately following command.
 * For csh/tcsh, we use setenv syntax since csh does not support inline VAR=value.
 */
export function buildShellAwareGitPrefix(bashPrefix: string, shellType?: ShellType): string {
  if (!bashPrefix) return ""
  const resolvedShellType = shellType ?? detectShellType()
  if (resolvedShellType === "unix") {
    return bashPrefix
  }
  const envRecord = parseBashEnvPrefix(bashPrefix)
  return buildEnvPrefix(envRecord, resolvedShellType)
}

/** The co-author git-master adds to every commit while `include_co_authored_by` is on (the default). */
export const SISYPHUS_CO_AUTHOR_TRAILER = "Co-authored-by: sisyphus-dev-ai <sisyphus-dev-ai@users.noreply.github.com>"

/**
 * `addIfDifferent` makes git itself keep a single copy of the trailer: a message that already
 * carries it (an amend or a reworded commit) is not given a second one. A squash joins messages
 * without `--trailer` and keeps both copies, so the instruction asks for one rewrite afterwards.
 */
const DEDUP_TRAILER_GIT_OPTION = "-c trailer.ifexists=addIfDifferent"

function buildAttributedCommitExample(
  commandPrefix: string,
  footerText: string | undefined,
  includeCoAuthor: boolean,
): string {
  const parts = [
    commandPrefix === "" ? "git" : `${commandPrefix} git`,
    ...(includeCoAuthor ? [DEDUP_TRAILER_GIT_OPTION] : []),
    'commit -m "{Commit Message}"',
    ...(footerText === undefined ? [] : [`-m "${footerText}"`]),
    ...(includeCoAuthor ? [`--trailer "${SISYPHUS_CO_AUTHOR_TRAILER}"`] : []),
  ]
  return parts.join(" ")
}

export interface GitAttributionSettings {
  readonly commit_footer: boolean | string
  readonly include_co_authored_by: boolean
}

/**
 * Commit attribution: the `Co-authored-by` trailer is on by default (`include_co_authored_by`) and
 * the body footer is opt-in (`commit_footer`; `true` uses `defaultFooter`). Author and committer stay
 * the operator's own git identity. Returns `undefined` when both are off.
 */
export function buildGitAttributionDirective(
  settings: GitAttributionSettings,
  commandPrefix: string,
  defaultFooter: string,
): string | undefined {
  const footerText =
    settings.commit_footer === false
      ? undefined
      : typeof settings.commit_footer === "string"
        ? settings.commit_footer
        : defaultFooter
  const includeCoAuthor = settings.include_co_authored_by
  if (footerText === undefined && !includeCoAuthor) return undefined

  const example = `\`${buildAttributedCommitExample(commandPrefix, footerText, includeCoAuthor)}\``
  const footerClause = footerText === undefined ? "" : ` and ends its body with ${footerText}`
  const sentence = includeCoAuthor
    ? `Every commit you create carries \`${SISYPHUS_CO_AUTHOR_TRAILER}\` exactly once${footerClause}: ${example}. After a squash, amend once with a fresh \`-m\` so one copy remains.`
    : `Every commit you create ends its body with ${footerText} and carries no Co-authored-by trailer: ${example}.`
  return [COMMIT_ATTRIBUTION_OPEN_TAG, sentence, "</commit_attribution>"].join("\n")
}

/**
 * The configured env assignments in both forms a git command can carry them: `.env(...)` on the
 * `Bun.$` helper (Bun.$ does not apply a `VAR=x cmd` text prefix) and a prefix on a shell line.
 */
function buildGitEnvPrefixBlock(gitEnvPrefix: string, shellType: ShellType): string {
  const assignments = Object.entries(parseBashEnvPrefix(gitEnvPrefix))
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ")
  const linePrefix = buildShellAwareGitPrefix(gitEnvPrefix, shellType)
  return [
    GIT_ENV_PREFIX_OPEN_TAG,
    `Run git with \`${gitEnvPrefix}\` in its environment for the user's git hooks: \`.env({ ...process.env, ${assignments} })\` on the helper's \`Bun.$\`, \`${linePrefix} git\` on a \`tool.bash\` line.`,
    "</git_env_prefix>",
  ].join("\n")
}

export function insertGitEnvPrefixBlock(text: string, gitEnvPrefix: string, shellType: ShellType): string {
  if (text.includes(GIT_ENV_PREFIX_OPEN_TAG)) return text
  const frontmatter = FRONTMATTER_PATTERN.exec(text)?.[0] ?? ""
  return `${frontmatter}${buildGitEnvPrefixBlock(gitEnvPrefix, shellType)}\n\n${text.slice(frontmatter.length).replace(/^\n+/, "")}`
}

const OPENCODE_DEFAULT_COMMIT_FOOTER = "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)"

export function injectGitMasterConfig(
  template: string,
  config?: GitMasterConfig,
  shellType: ShellType = detectShellType(),
): string {
  const gitEnvPrefix = assertValidGitEnvPrefix(config?.git_env_prefix ?? "GIT_MASTER=1")
  const commandPrefix = gitEnvPrefix ? buildShellAwareGitPrefix(gitEnvPrefix, shellType) : ""
  const directive = buildGitAttributionDirective(
    { commit_footer: config?.commit_footer ?? false, include_co_authored_by: config?.include_co_authored_by ?? true },
    commandPrefix,
    OPENCODE_DEFAULT_COMMIT_FOOTER,
  )
  const withPrefix = gitEnvPrefix ? insertGitEnvPrefixBlock(template, gitEnvPrefix, shellType) : template
  return directive === undefined || withPrefix.includes(COMMIT_ATTRIBUTION_OPEN_TAG)
    ? withPrefix
    : `${withPrefix}\n\n${directive}`
}
