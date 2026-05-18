import { assertValidGitEnvPrefix, type GitMasterConfig } from "../../config/schema"
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
 * for PowerShell ($env:VAR='value';), cmd (set VAR="value" &&), or unix (VAR=value).
 *
 * For unix shells, we use the inline VAR=value prefix style (not export) to match
 * the original behavior where the env var applies only to the immediately following command.
 */
export function buildShellAwareGitPrefix(bashPrefix: string, shellType?: ShellType): string {
	if (!bashPrefix) return ""
	const resolvedShellType = shellType ?? detectShellType()
	if (resolvedShellType === "unix" || resolvedShellType === "csh") {
		return bashPrefix
	}
	const envRecord = parseBashEnvPrefix(bashPrefix)
	return buildEnvPrefix(envRecord, resolvedShellType)
}

export function injectGitMasterConfig(template: string, config?: GitMasterConfig): string {
	const commitFooter = config?.commit_footer ?? true
	const includeCoAuthoredBy = config?.include_co_authored_by ?? true
	const gitEnvPrefix = assertValidGitEnvPrefix(config?.git_env_prefix ?? "GIT_MASTER=1")

	const shellType = detectShellType()
	const shellPrefix = gitEnvPrefix ? buildShellAwareGitPrefix(gitEnvPrefix, shellType) : ""
	const codeBlockLang = shellType === "powershell" ? "pwsh" : "bash"
	const skipBashBlockPrefixing = shellType === "powershell" || shellType === "cmd"

	let result = gitEnvPrefix ? injectGitEnvPrefix(template, shellPrefix, codeBlockLang) : template

	if (commitFooter || includeCoAuthoredBy) {
		const injection = buildCommitFooterInjection(commitFooter, includeCoAuthoredBy, shellPrefix)
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

function buildCommitFooterInjection(
	commitFooter: boolean | string,
	includeCoAuthoredBy: boolean,
	gitEnvPrefix: string,
): string {
	const sections: string[] = []
	const cmdPrefix = gitEnvPrefix ? `${gitEnvPrefix} ` : ""

	sections.push("### 5.5 Commit Footer & Co-Author")
	sections.push("")
	sections.push("Add Sisyphus attribution to EVERY commit:")
	sections.push("")

	if (commitFooter) {
		const footerText =
			typeof commitFooter === "string"
				? commitFooter
				: "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)"
		sections.push("1. **Footer in commit body:**")
		sections.push("```")
		sections.push(footerText)
		sections.push("```")
		sections.push("")
	}

	if (includeCoAuthoredBy) {
		sections.push(`${commitFooter ? "2" : "1"}. **Co-authored-by trailer:**`)
		sections.push("```")
		sections.push("Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>")
		sections.push("```")
		sections.push("")
	}

	if (commitFooter && includeCoAuthoredBy) {
		const footerText =
			typeof commitFooter === "string"
				? commitFooter
				: "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)"
		sections.push("**Example (both enabled):**")
		sections.push("```bash")
		sections.push(
			`${cmdPrefix}git commit -m "{Commit Message}" -m "${footerText}" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"`
		)
		sections.push("```")
	} else if (commitFooter) {
		const footerText =
			typeof commitFooter === "string"
				? commitFooter
				: "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-openagent)"
		sections.push("**Example:**")
		sections.push("```bash")
		sections.push(`${cmdPrefix}git commit -m "{Commit Message}" -m "${footerText}"`)
		sections.push("```")
	} else if (includeCoAuthoredBy) {
		sections.push("**Example:**")
		sections.push("```bash")
		sections.push(
			`${cmdPrefix}git commit -m "{Commit Message}" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"`
		)
		sections.push("```")
	}

	return sections.join("\n")
}
