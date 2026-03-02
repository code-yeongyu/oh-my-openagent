import { createSystemDirective } from "../../shared/system-directive"
import { log } from "../../shared/logger"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

const HOOK_NAME = "compaction-skill-injector"
const DIRECTIVE = createSystemDirective("SKILL INDEX")
const MAX_DESCRIPTION_LENGTH = 120

type GetAllSkillsFn = (opts: { directory: string }) => Promise<LoadedSkill[]>

function formatSkillLine(skill: LoadedSkill): string {
	const scope = skill.scope === "builtin" ? "builtin" : skill.scope
	const rawDesc = skill.definition.description ?? ""
	// Strip scope prefix added by loader e.g. "(project - Skill) ..."
	const desc = rawDesc.replace(/^\([^)]+\)\s*/, "")
	const truncated = desc.length > MAX_DESCRIPTION_LENGTH ? `${desc.slice(0, MAX_DESCRIPTION_LENGTH)}…` : desc
	return `- ${skill.name} (${scope})${truncated ? `: ${truncated}` : ""}`
}

function buildSkillIndex(skills: LoadedSkill[]): string {
	if (skills.length === 0) {
		return `${DIRECTIVE}\nNo skills are currently available.`
	}

	const lines = [
		DIRECTIVE,
		"Skills available in this session. Use skill(name=\"...\") to load any of them.",
		"Use /skill [query] to search by name or description.",
		"",
		...skills.map(formatSkillLine),
	]

	return lines.join("\n")
}

export function createCompactionSkillInjector(
	getAllSkills: GetAllSkillsFn,
	directory: string,
): () => Promise<string> {
	return async (): Promise<string> => {
		try {
			const skills = await getAllSkills({ directory })
			const index = buildSkillIndex(skills)
			log(`[${HOOK_NAME}] Injecting skill index`, { count: skills.length })
			return index
		} catch (err) {
			log(`[${HOOK_NAME}] Failed to build skill index`, { error: String(err) })
			return `${DIRECTIVE}\nSkill index unavailable (failed to load).`
		}
	}
}
