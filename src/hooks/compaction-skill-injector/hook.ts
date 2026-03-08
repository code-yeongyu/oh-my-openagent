import { buildSkillIndex } from "../../shared/skill-index-builder"
import { log } from "../../shared/logger"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

const HOOK_NAME = "compaction-skill-injector"

type GetAllSkillsFn = (opts: { directory: string }) => Promise<LoadedSkill[]>

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
			return buildSkillIndex([])
		}
	}
}
