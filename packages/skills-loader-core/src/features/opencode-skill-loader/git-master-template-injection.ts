import type { GitMasterConfig } from "../../types"
import { assertValidGitEnvPrefix } from "../../config/git-env-prefix"
import { detectShellType, buildEnvPrefix, type ShellType } from "../../shared/shell-env"

const BASH_CODE_BLOCK_PATTERN = /```bash\r?\n([\s\S]*?)```/g
const LEADING_GIT_COMMAND_PATTERN = /^([ \t]*(?:[A-Za-z_][A-Za-z0-9_]*=[^ \t]+\s+)*)git(?=[ \t]|$)/gm
const INLINE_GIT_COMMAND_PATTERN = /([;&|()][ \t]*)git(?=[ \t]|$)/g

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
export const SISYPHUS_CO_AUTHOR_TRAILER =
	"Co-authored-by: sisyphus-dev-ai <sisyphus-dev-ai@users.noreply.github.com>"

/**
 * `addIfDifferent` makes git itself keep a single copy of the trailer: a message that already
 * carries it (an amend or a reworded commit) is not given a second one. A squash joins messages
 * without `--trailer` and keeps both copies, so the instruction asks for one rewrite afterwards.
 */
const DEDUP_TRAILER_GIT_OPTION = "-c trailer.ifexists=addIfDifferent"

export const CO_AUTHOR_TRAILER_INSTRUCTION = [
	`**Co-author trailer, exactly once:** \`${SISYPHUS_CO_AUTHOR_TRAILER}\`.`,
	`Pass it with \`--trailer\`, never inside \`-m\`, and run the commit as \`git ${DEDUP_TRAILER_GIT_OPTION} commit ...\`,`,
	"so a message that already carries it keeps a single copy.",
	"A squash joins messages without `--trailer` and can leave two copies, so after squashing rewrite the message once",
	"with the same command plus `--amend` and a fresh `-m` that does not repeat the trailer.",
].join(" ")

export const NO_CO_AUTHOR_INSTRUCTION = "Do NOT add a Co-authored-by trailer."

export function buildAttributedCommitExample(
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

/**
 * Commit attribution: the `Co-authored-by` trailer is on by default (`include_co_authored_by`)
 * and the body footer is opt-in (`commit_footer`, default off). Author and committer stay the
 * operator's own git identity.
 */
export function injectGitMasterConfig(
	template: string,
	config?: GitMasterConfig,
	shellType: ShellType = detectShellType(),
): string {
	const commitFooter = config?.commit_footer ?? false
	const includeCoAuthor = config?.include_co_authored_by ?? true
	const gitEnvPrefix = assertValidGitEnvPrefix(config?.git_env_prefix ?? "GIT_MASTER=1")

	const shellPrefix = gitEnvPrefix ? buildShellAwareGitPrefix(gitEnvPrefix, shellType) : ""
	const codeBlockLang = shellType === "powershell" ? "pwsh" : shellType === "csh" ? "csh" : "bash"
	const skipBashBlockPrefixing = shellType === "powershell" || shellType === "cmd" || shellType === "csh"

	let result = gitEnvPrefix ? injectGitEnvPrefix(template, shellPrefix, codeBlockLang) : template

	if (commitFooter || includeCoAuthor) {
		const injection = buildCommitAttributionInjection(commitFooter, includeCoAuthor, shellPrefix)
		const insertionPoint = result.indexOf("```\n</execution>")

		result =
			insertionPoint !== -1
				? result.slice(0, insertionPoint) +
					"```\n\n" +
					injection +
					"\n</execution>" +
					result.slice(insertionPoint + "```\n</execution>".length)
				: result + "\n\n" + injection
	}

	if (gitEnvPrefix && !skipBashBlockPrefixing) {
		result = prefixGitCommandsInBashCodeBlocks(result, shellPrefix)
	}

	return result
}

function injectGitEnvPrefix(template: string, prefix: string, codeBlockLang: string): string {
	const envPrefixSection = [
		"## GIT COMMAND PREFIX (MANDATORY)",
		"",
		`<git_env_prefix>`,
		`**EVERY git command MUST be prefixed with \`${prefix}\`.**`,
		"",
		"This allows custom git hooks to detect when git-master skill is active.",
		"",
		`\`\`\`${codeBlockLang}`,
		`${prefix} git status`,
		`${prefix} git add <files>`,
		`${prefix} git commit -m "message"`,
		`${prefix} git push`,
		`${prefix} git rebase ...`,
		`${prefix} git log ...`,
		"```",
		"",
		"**NO EXCEPTIONS. Every `git` invocation must include this prefix.**",
		`</git_env_prefix>`,
	].join("\n")

	const modeDetectionMarker = "## MODE DETECTION (FIRST STEP)"
	const markerIndex = template.indexOf(modeDetectionMarker)
	if (markerIndex !== -1) {
		return (
			template.slice(0, markerIndex) +
			envPrefixSection +
			"\n\n---\n\n" +
			template.slice(markerIndex)
		)
	}

	return envPrefixSection + "\n\n---\n\n" + template
}

function prefixGitCommandsInBashCodeBlocks(template: string, prefix: string): string {
	return template.replace(BASH_CODE_BLOCK_PATTERN, (block, codeBlock: string) => {
		return block.replace(codeBlock, prefixGitCommandsInCodeBlock(codeBlock, prefix))
	})
}

function prefixGitCommandsInCodeBlock(codeBlock: string, prefix: string): string {
	return codeBlock
		.split("\n")
		.map((line) => {
			if (line.includes(prefix)) {
				return line
			}
			return line
				.replace(LEADING_GIT_COMMAND_PATTERN, `$1${prefix} git`)
				.replace(INLINE_GIT_COMMAND_PATTERN, `$1${prefix} git`)
		})
		.join("\n")
}

function buildCommitAttributionInjection(
	commitFooter: boolean | string,
	includeCoAuthor: boolean,
	gitEnvPrefix: string,
): string {
	const footerText =
		commitFooter === false
			? undefined
			: typeof commitFooter === "string"
				? commitFooter
				: "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)"

	const footerStep = footerText === undefined ? [] : ["1. **Footer in commit body:**", "```", footerText, "```", ""]
	const coAuthorStep = includeCoAuthor
		? `${footerText === undefined ? 1 : 2}. ${CO_AUTHOR_TRAILER_INSTRUCTION}`
		: NO_CO_AUTHOR_INSTRUCTION
	const steps = [...footerStep, coAuthorStep, ""]

	return [
		"### 5.5 Commit Attribution",
		"",
		"Add Sisyphus attribution to EVERY commit:",
		"",
		...steps,
		"**Example:**",
		"```bash",
		buildAttributedCommitExample(gitEnvPrefix, footerText, includeCoAuthor),
		"```",
	].join("\n")
}
