import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { matchSkillByName } from "../../tools/skill/skill-matcher"
import {
	findProjectAgentsSkillDirs,
	findProjectClaudeSkillDirs,
	findProjectOpencodeSkillDirs,
	getClaudeConfigDir,
	getOpenCodeSkillDirs,
} from "../../shared"
import { createBuiltinSkills } from "../builtin-skills/skills"
import { injectGitMasterConfig } from "./git-master-template-injection"
import { extractSkillTemplate } from "./loaded-skill-template-extractor"
import { loadSkillFromPath } from "./loaded-skill-from-path"
import { getAllSkills } from "./skill-discovery"
import type { SkillResolutionOptions } from "./skill-resolution-options"
import type { LoadedSkill, SkillScope } from "./types"

export function resolveSkillContent(skillName: string, options?: SkillResolutionOptions): string | null {
	const skills = createBuiltinSkills({
		browserProvider: options?.browserProvider,
		disabledSkills: options?.disabledSkills,
		teamModeEnabled: options?.teamModeEnabled,
	})
	const skill = skills.find((builtinSkill) => builtinSkill.name === skillName)
	if (!skill) return null

	if (skill.name === "git-master") {
		return injectGitMasterConfig(skill.template, options?.gitMasterConfig)
	}

	return skill.template
}

export function resolveMultipleSkills(
	skillNames: string[],
	options?: SkillResolutionOptions
): { resolved: Map<string, string>; notFound: string[] } {
	const skills = createBuiltinSkills({
		browserProvider: options?.browserProvider,
		disabledSkills: options?.disabledSkills,
		teamModeEnabled: options?.teamModeEnabled,
	})
	const skillMap = new Map(skills.map((skill) => [skill.name, skill]))

	const resolved = new Map<string, string>()
	const notFound: string[] = []

	for (const name of skillNames) {
		const match = skillMap.get(name)
		if (match) {
			if (match.name === "git-master") {
				resolved.set(name, injectGitMasterConfig(match.template, options?.gitMasterConfig))
			} else {
				resolved.set(name, match.template)
			}
		} else {
			notFound.push(name)
		}
	}

	return { resolved, notFound }
}

async function loadExactSkillFromRoot(
	skillsDir: string,
	scope: SkillScope,
	skillName: string
): Promise<LoadedSkill | null> {
	const skillDirectory = join(skillsDir, skillName)
	const candidates = [
		{ path: join(skillDirectory, "SKILL.md"), resolvedPath: skillDirectory },
		{ path: join(skillDirectory, `${skillName}.md`), resolvedPath: skillDirectory },
		{ path: join(skillsDir, `${skillName}.md`), resolvedPath: skillsDir },
	]

	for (const candidate of candidates) {
		if (!existsSync(candidate.path)) continue
		const skill = await loadSkillFromPath({
			skillPath: candidate.path,
			resolvedPath: candidate.resolvedPath,
			defaultName: skillName,
			scope,
		})
		if (skill?.name === skillName) return skill
	}

	return null
}

async function loadConfiguredGitMasterSkill(options?: SkillResolutionOptions): Promise<LoadedSkill | null> {
	const directory = options?.directory ?? process.cwd()
	const rootGroups: Array<{ readonly roots: readonly string[]; readonly scope: SkillScope }> = [
		{ roots: findProjectOpencodeSkillDirs(directory), scope: "opencode-project" },
		{ roots: getOpenCodeSkillDirs({ binary: "opencode" }), scope: "opencode" },
		{ roots: findProjectClaudeSkillDirs(directory), scope: "project" },
		{ roots: findProjectAgentsSkillDirs(directory), scope: "project" },
		{ roots: [join(getClaudeConfigDir(), "skills")], scope: "user" },
		{ roots: [join(homedir(), ".agents", "skills")], scope: "user" },
	]

	for (const group of rootGroups) {
		for (const root of group.roots) {
			const skill = await loadExactSkillFromRoot(root, group.scope, "git-master")
			if (skill) return skill
		}
	}

	return null
}

async function resolveBuiltinSkillTemplate(skillName: string, options?: SkillResolutionOptions): Promise<string | null> {
	if (skillName !== "git-master") return null
	if (options?.disabledSkills?.has(skillName)) return null

	const configuredSkill = await loadConfiguredGitMasterSkill(options)
	if (configuredSkill) return injectGitMasterConfig(await extractSkillTemplate(configuredSkill), options?.gitMasterConfig)

	const skills = createBuiltinSkills({
		browserProvider: options?.browserProvider,
		disabledSkills: options?.disabledSkills,
		teamModeEnabled: options?.teamModeEnabled,
	})
	const skill = skills.find((builtinSkill) => builtinSkill.name === skillName)
	if (!skill) return null

	return injectGitMasterConfig(skill.template, options?.gitMasterConfig)
}

export async function resolveSkillContentAsync(
	skillName: string,
	options?: SkillResolutionOptions
): Promise<string | null> {
	const builtinTemplate = await resolveBuiltinSkillTemplate(skillName, options)
	if (builtinTemplate !== null) return builtinTemplate

	const allSkills = await getAllSkills(options)
	const skill = matchSkillByName(allSkills, skillName)
	if (!skill) return null

	const template = await extractSkillTemplate(skill)

	if (skill.name === "git-master") {
		return injectGitMasterConfig(template, options?.gitMasterConfig)
	}

	return template
}

export async function resolveMultipleSkillsAsync(
	skillNames: string[],
	options?: SkillResolutionOptions
): Promise<{ resolved: Map<string, string>; notFound: string[] }> {
	const resolvedTemplates = new Map<string, string>()
	const unresolvedSkillNames: string[] = []
	for (const name of skillNames) {
		const builtinTemplate = await resolveBuiltinSkillTemplate(name, options)
		if (builtinTemplate !== null) {
			resolvedTemplates.set(name, builtinTemplate)
		} else {
			unresolvedSkillNames.push(name)
		}
	}

	if (unresolvedSkillNames.length === 0) {
		return { resolved: createOrderedResolvedMap(skillNames, resolvedTemplates), notFound: [] }
	}

	const allSkills = await getAllSkills(options)

	const notFound: string[] = []

	for (const name of unresolvedSkillNames) {
		const skill = matchSkillByName(allSkills, name)
		if (skill) {
			const template = await extractSkillTemplate(skill)
			if (skill.name === "git-master") {
				resolvedTemplates.set(name, injectGitMasterConfig(template, options?.gitMasterConfig))
			} else {
				resolvedTemplates.set(name, template)
			}
		} else {
			notFound.push(name)
		}
	}

	return { resolved: createOrderedResolvedMap(skillNames, resolvedTemplates), notFound }
}

function createOrderedResolvedMap(skillNames: string[], templatesByName: ReadonlyMap<string, string>): Map<string, string> {
	const ordered = new Map<string, string>()
	for (const name of skillNames) {
		const template = templatesByName.get(name)
		if (template !== undefined) {
			ordered.set(name, template)
		}
	}
	return ordered
}
