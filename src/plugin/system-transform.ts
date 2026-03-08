import { buildSkillIndex } from "../shared/skill-index-builder"
import { log } from "../shared/logger"
import type { LoadedSkill } from "../features/opencode-skill-loader/types"

const HANDLER_NAME = "system-transform"

export function createSystemTransformHandler(skills: LoadedSkill[]): (
  input: { sessionID: string },
  output: { system: string[] },
) => Promise<void> {
  const injectedSessions = new Set<string>()

  return async (input, output): Promise<void> => {
    if (injectedSessions.has(input.sessionID)) return
    injectedSessions.add(input.sessionID)

    try {
      const index = buildSkillIndex(skills, "enforcement")
      output.system.push(index)
      log(`[${HANDLER_NAME}] Injected skill index`, { count: skills.length })
    } catch (err) {
      log(`[${HANDLER_NAME}] Failed to inject skill index`, { error: String(err) })
    }
  }
}
