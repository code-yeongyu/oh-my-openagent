import { createBuiltinSkills } from "../builtin-skills/skills"
import { discoverSkills } from "./loader"
import type { LoadedSkill } from "./types"
import { parseFrontmatter } from "../../shared/frontmatter"
import { readFileSync } from "node:fs"
import type { GitMasterConfig } from "../../config/schema"

export interface SkillResolutionOptions {
	gitMasterConfig?: GitMasterConfig
}

let cachedSkills: LoadedSkill[] | null = null

function clearSkillCache(): void {
	cachedSkills = null
}

async function getAllSkills(): Promise<LoadedSkill[]> {
	if (cachedSkills) return cachedSkills

	const [discoveredSkills, builtinSkillDefs] = await Promise.all([
		discoverSkills({ includeClaudeCodePaths: true }),
		Promise.resolve(createBuiltinSkills()),
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

	cachedSkills = [...discoveredSkills, ...uniqueBuiltins]
	return cachedSkills
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

function injectGitMasterConfig(template: string, config?: GitMasterConfig): string {
	if (!config) return template

	const commitFooter = config.commit_footer ?? true
	const includeCoAuthoredBy = config.include_co_authored_by ?? true

	const configHeader = `## Git Master Configuration (from oh-my-opencode.json)

**IMPORTANT: These values override the defaults in section 5.5:**
- \`commit_footer\`: ${commitFooter} ${!commitFooter ? "(DISABLED - do NOT add footer)" : ""}
- \`include_co_authored_by\`: ${includeCoAuthoredBy} ${!includeCoAuthoredBy ? "(DISABLED - do NOT add Co-authored-by)" : ""}

---

`
	return configHeader + template
}

export function resolveSkillContent(skillName: string, options?: SkillResolutionOptions): string | null {
	const skills = createBuiltinSkills()
	const skill = skills.find((s) => s.name === skillName)
	if (!skill) return null

	if (skillName === "git-master" && options?.gitMasterConfig) {
		return injectGitMasterConfig(skill.template, options.gitMasterConfig)
	}

	return skill.template
}

export function resolveMultipleSkills(skillNames: string[], options?: SkillResolutionOptions): {
	resolved: Map<string, string>
	notFound: string[]
} {
	const skills = createBuiltinSkills()
	const skillMap = new Map(skills.map((s) => [s.name, s.template]))

	const resolved = new Map<string, string>()
	const notFound: string[] = []

	for (const name of skillNames) {
		const template = skillMap.get(name)
		if (template) {
			if (name === "git-master" && options?.gitMasterConfig) {
				resolved.set(name, injectGitMasterConfig(template, options.gitMasterConfig))
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
	const allSkills = await getAllSkills()
	const skill = allSkills.find((s) => s.name === skillName)
	if (!skill) return null

	const template = await extractSkillTemplate(skill)

	if (skillName === "git-master" && options?.gitMasterConfig) {
		return injectGitMasterConfig(template, options.gitMasterConfig)
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
	const allSkills = await getAllSkills()
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
			if (name === "git-master" && options?.gitMasterConfig) {
				resolved.set(name, injectGitMasterConfig(template, options.gitMasterConfig))
			} else {
				resolved.set(name, template)
			}
		} else {
			notFound.push(name)
		}
	}

	return { resolved, notFound }
}
