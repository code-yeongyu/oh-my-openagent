import { buildSkillIndex } from "../shared/skill-index-builder"
import { log } from "../shared/logger"
import type { LoadedSkill } from "../features/opencode-skill-loader/types"

const HANDLER_NAME = "system-transform"

export function createSystemTransformHandler(skills: LoadedSkill[]): (
  input: { sessionID: string },
  output: { system: string[] },
) => Promise<void> {
  return async (_input, output): Promise<void> => {
    try {
      const index = buildSkillIndex(skills, "enforcement")
      output.system.push(index)
      log(`[${HANDLER_NAME}] Injected skill index`, { count: skills.length })
    } catch (err) {
      log(`[${HANDLER_NAME}] Failed to inject skill index`, { error: String(err) })
    }
  }
}
