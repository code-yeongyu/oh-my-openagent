import { createBuiltinSkills } from "../builtin-skills/skills"
import { discoverSkills } from "./loader"
import type { LoadedSkill } from "./types"
import { parseFrontmatter } from "../../shared/frontmatter"
import { readFileSync } from "node:fs"
import type { GitMasterConfig, BrowserAutomationProvider } from "../../config/schema"

export interface SkillResolutionOptions {
	gitMasterConfig?: GitMasterConfig
	browserProvider?: BrowserAutomationProvider
}

const cachedSkillsByProvider = new Map<string, LoadedSkill[]>()

function clearSkillCache(): void {
	cachedSkillsByProvider.clear()
}

async function getAllSkills(options?: SkillResolutionOptions): Promise<LoadedSkill[]> {
	const cacheKey = options?.browserProvider ?? "playwright"
	const cached = cachedSkillsByProvider.get(cacheKey)
	if (cached) return cached

	const [discoveredSkills, builtinSkillDefs] = await Promise.all([
		discoverSkills({ includeClaudeCodePaths: true }),
		Promise.resolve(createBuiltinSkills({ browserProvider: options?.browserProvider })),
	])

	const builtinSkillsAsLoaded: LoadedSkill[] = builtinSkillDefs.map((skill) => ({
		name: skill.name,
		definition: {
			name: skill.name,
			description: skill.description,
			template: skill.template,
			model: skill.model,
			agent: skill.agent,
			subtask: skill.subtask,
		},
		scope: "builtin" as const,
		license: skill.license,
		compatibility: skill.compatibility,
		metadata: skill.metadata as Record<string, string> | undefined,
		allowedTools: skill.allowedTools,
		mcpConfig: skill.mcpConfig,
	}))

	const discoveredNames = new Set(discoveredSkills.map((s) => s.name))
	const uniqueBuiltins = builtinSkillsAsLoaded.filter((s) => !discoveredNames.has(s.name))

	const allSkills = [...discoveredSkills, ...uniqueBuiltins]
	cachedSkillsByProvider.set(cacheKey, allSkills)
	return allSkills
}

async function extractSkillTemplate(skill: LoadedSkill): Promise<string> {
	if (skill.path) {
		const content = readFileSync(skill.path, "utf-8")
		const { body } = parseFrontmatter(content)
		return body.trim()
	}
	return skill.definition.template || ""
}

export { clearSkillCache, getAllSkills, extractSkillTemplate }

export function injectGitMasterConfig(template: string, config?: GitMasterConfig): string {
	const commitFooter = config?.commit_footer ?? true
	const includeCoAuthoredBy = config?.include_co_authored_by ?? true

	if (!commitFooter && !includeCoAuthoredBy) {
		return template
	}

	const sections: string[] = []

	sections.push(`### 5.5 Commit Footer & Co-Author`)
	sections.push(``)
	sections.push(`Add Sisyphus attribution to EVERY commit:`)
	sections.push(``)

	if (commitFooter) {
		sections.push(`1. **Footer in commit body:**`)
		sections.push("```")
		sections.push(`Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode)`)
		sections.push("```")
		sections.push(``)
	}

	if (includeCoAuthoredBy) {
		sections.push(`${commitFooter ? "2" : "1"}. **Co-authored-by trailer:**`)
		sections.push("```")
		sections.push(`Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>`)
		sections.push("```")
		sections.push(``)
	}

	if (commitFooter && includeCoAuthoredBy) {
		sections.push(`**Example (both enabled):**`)
		sections.push("```bash")
		sections.push(`git commit -m "{Commit Message}" -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode)" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"`)
		sections.push("```")
	} else if (commitFooter) {
		sections.push(`**Example:**`)
		sections.push("```bash")
		sections.push(`git commit -m "{Commit Message}" -m "Ultraworked with [Sisyphus](https://github.com/code-yeongyu/oh-my-opencode)"`)
		sections.push("```")
	} else if (includeCoAuthoredBy) {
		sections.push(`**Example:**`)
		sections.push("```bash")
		sections.push(`git commit -m "{Commit Message}" -m "Co-authored-by: Sisyphus <clio-agent@sisyphuslabs.ai>"`)
		sections.push("```")
	}

	const injection = sections.join("\n")

	const insertionPoint = template.indexOf("```\n</execution>")
	if (insertionPoint !== -1) {
		return template.slice(0, insertionPoint) + "```\n\n" + injection + "\n</execution>" + template.slice(insertionPoint + "```\n</execution>".length)
	}

	return template + "\n\n" + injection
}

export function resolveSkillContent(skillName: string, options?: SkillResolutionOptions): string | null {
	const skills = createBuiltinSkills({ browserProvider: options?.browserProvider })
	const skill = skills.find((s) => s.name === skillName)
	if (!skill) return null

	if (skillName === "git-master") {
		return injectGitMasterConfig(skill.template, options?.gitMasterConfig)
	}

	return skill.template
}

export function resolveMultipleSkills(skillNames: string[], options?: SkillResolutionOptions): {
	resolved: Map<string, string>
	notFound: string[]
} {
	const skills = createBuiltinSkills({ browserProvider: options?.browserProvider })
	const skillMap = new Map(skills.map((s) => [s.name, s.template]))

	const resolved = new Map<string, string>()
	const notFound: string[] = []

	for (const name of skillNames) {
		const template = skillMap.get(name)
		if (template) {
			if (name === "git-master") {
				resolved.set(name, injectGitMasterConfig(template, options?.gitMasterConfig))
			} else {
				resolved.set(name, template)
			}
		} else {
			notFound.push(name)
		}
	}

	return { resolved, notFound }
}

export async function resolveSkillContentAsync(
	skillName: string,
	options?: SkillResolutionOptions
): Promise<string | null> {
	const allSkills = await getAllSkills(options)
	const skill = allSkills.find((s) => s.name === skillName)
	if (!skill) return null

	const template = await extractSkillTemplate(skill)

	if (skillName === "git-master") {
		return injectGitMasterConfig(template, options?.gitMasterConfig)
	}

	return template
}

export async function resolveMultipleSkillsAsync(
	skillNames: string[],
	options?: SkillResolutionOptions
): Promise<{
	resolved: Map<string, string>
	notFound: string[]
}> {
	const allSkills = await getAllSkills(options)
	const skillMap = new Map<string, LoadedSkill>()
	for (const skill of allSkills) {
		skillMap.set(skill.name, skill)
	}

	const resolved = new Map<string, string>()
	const notFound: string[] = []

	for (const name of skillNames) {
		const skill = skillMap.get(name)
		if (skill) {
			const template = await extractSkillTemplate(skill)
			if (name === "git-master") {
				resolved.set(name, injectGitMasterConfig(template, options?.gitMasterConfig))
			} else {
				resolved.set(name, template)
			}
		} else {
			notFound.push(name)
		}
	}

	return { resolved, notFound }
}
