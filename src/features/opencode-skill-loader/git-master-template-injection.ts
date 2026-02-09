import type { GitMasterConfig } from "../../config/schema"

export function injectGitMasterConfig(template: string, config?: GitMasterConfig): string {
	const commitFooter = config?.commit_footer ?? true
	const includeCoAuthoredBy = config?.include_co_authored_by ?? true

	if (!commitFooter && !includeCoAuthoredBy) {
		return template
	}

	const sections: string[] = []

	sections.push("### 5.5 Commit Footer & Co-Author")
	sections.push("")
	sections.push("Add Sisyphus attribution to EVERY commit:")
	sections.push("")

	if (commitFooter) {
		const footerText =
			typeof commitFooter === "string"
				? commitFooter
				: "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode)"
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
				: "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode)"
		sections.push("**Example (both enabled):**")
		sections.push("```bash")
		sections.push(
			`git commit -m "{Commit Message}" -m "${footerText}" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"`
		)
		sections.push("```")
	} else if (commitFooter) {
		const footerText =
			typeof commitFooter === "string"
				? commitFooter
				: "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode)"
		sections.push("**Example:**")
		sections.push("```bash")
		sections.push(`git commit -m "{Commit Message}" -m "${footerText}"`)
		sections.push("```")
	} else if (includeCoAuthoredBy) {
		sections.push("**Example:**")
		sections.push("```bash")
		sections.push(
			"git commit -m \"{Commit Message}\" -m \"Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>\""
		)
		sections.push("```")
	}

	const injection = sections.join("\n")

	const insertionPoint = template.indexOf("```\n</execution>")
	if (insertionPoint !== -1) {
		return (
			template.slice(0, insertionPoint) +
			"```\n\n" +
			injection +
			"\n</execution>" +
			template.slice(insertionPoint + "```\n</execution>".length)
		)
	}

	return template + "\n\n" + injection
}
