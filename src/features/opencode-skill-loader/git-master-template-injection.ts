import { assertValidGitEnvPrefix, type GitMasterConfig } from "../../config/schema"

const BASH_CODE_BLOCK_PATTERN = /```bash\r?\n([\s\S]*?)```/g
const LEADING_GIT_COMMAND_PATTERN = /^([ \t]*(?:[A-Za-z_][A-Za-z0-9_]*=[^ \t]+\s+)*)git(?=[ \t]|$)/gm
const INLINE_GIT_COMMAND_PATTERN = /([;&|()][ \t]*)git(?=[ \t]|$)/g

// Shell detection (exposed for testing)
export function detectShellType(): "bash" | "pwsh" {
	if (process.platform === "win32") {
		const shell = process.env.Shell ?? process.env.ComSpec ?? ""
		if (/powershell|pwsh|psexec/i.test(shell)) {
			return "pwsh"
		}
		// On Windows outside of known shells, assume PowerShell
		return "pwsh"
	}
	const shell = process.env.SHELL ?? ""
	if (/powershell|pwsh/i.test(shell)) {
		return "pwsh"
	}
	return "bash"
}

/** Convert a bash-format env prefix ("VAR=value VAR2=value2") to PowerShell format */
function convertEnvPrefixForPwsh(bashPrefix: string): string {
	const result: string[] = []
	let i = 0
	while (i < bashPrefix.length) {
		// Skip leading whitespace
		while (i < bashPrefix.length && bashPrefix[i] === " ") i++
		if (i >= bashPrefix.length) break

		// Find the key name (up to '=')
		const eqIndex = bashPrefix.indexOf("=", i)
		if (eqIndex === -1) {
			// No '=' found, append remaining as-is
			result.push(bashPrefix.slice(i).replace(/\s+$/, ""))
			break
		}
		const key = bashPrefix.slice(i, eqIndex)
		i = eqIndex + 1

		// Extract value (respecting quotes)
		let value: string
		if (bashPrefix[i] === '"') {
			// Double-quoted: find closing "
			const end = bashPrefix.indexOf('"', i + 1)
			if (end === -1) {
				value = bashPrefix.slice(i + 1)
				i = bashPrefix.length
			} else {
				value = bashPrefix.slice(i + 1, end)
				i = end + 1
			}
		} else if (bashPrefix[i] === "'") {
			// Single-quoted: find closing '
			const end = bashPrefix.indexOf("'", i + 1)
			if (end === -1) {
				value = bashPrefix.slice(i + 1)
				i = bashPrefix.length
			} else {
				value = bashPrefix.slice(i + 1, end)
				i = end + 1
			}
		} else {
			// Unquoted: consume until next space
			const end = bashPrefix.indexOf(" ", i)
			if (end === -1) {
				value = bashPrefix.slice(i)
				i = bashPrefix.length
			} else {
				value = bashPrefix.slice(i, end)
				i = end
			}
		}

		result.push(`$env:${key}='${value}'`)
	}
	return result.join("; ")
}

export function getShellAwareEnvPrefix(bashPrefix: string): string {
	if (detectShellType() === "pwsh") {
		return convertEnvPrefixForPwsh(bashPrefix)
	}
	return bashPrefix
}

/**
 * Returns true if the given shell prefix is PowerShell format.
 * Used to avoid injecting pwsh syntax into ```bash blocks.
 */
function isPwshPrefix(prefix: string): boolean {
	return prefix.includes("$env:")
}

export function injectGitMasterConfig(template: string, config?: GitMasterConfig): string {
	const commitFooter = config?.commit_footer ?? true
	const includeCoAuthoredBy = config?.include_co_authored_by ?? true
	const gitEnvPrefix = assertValidGitEnvPrefix(config?.git_env_prefix ?? "GIT_MASTER=1")
	const shellPrefix = gitEnvPrefix ? getShellAwareEnvPrefix(gitEnvPrefix) : ""
	// Bash code blocks should not get a PowerShell-prefix injection — it would
	// mix syntaxes inside a ```bash block. Only prefix if the prefix format
	// matches the code block language (or the block language is unspecified).
	const codeBlockPrefix = isPwshPrefix(shellPrefix) ? "" : shellPrefix

	// Determine the code block language for the injected env prefix section.
	// PowerShell-prefixed commands belong in a ```pwsh block, not ```bash.
	const codeBlockLang = isPwshPrefix(shellPrefix) ? "pwsh" : "bash"
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

	return gitEnvPrefix ? prefixGitCommandsInBashCodeBlocks(result, codeBlockPrefix) : result
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
