import { log } from "../../shared/logger"
import { writeSkillUsage } from "./memory-writer"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

const HOOK_NAME = "skill-usage-tracker"

export function createSkillUsageTrackerHook(mergedSkills: LoadedSkill[]) {
  const pending = new Map<string, string>()

  return {
    subscriptions: ["tool.execute.before", "tool.execute.after"],

    "tool.execute.before": async (
      input: { tool: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      if (input.tool.toLowerCase() !== "skill") return
      const skillName = output.args.name as string | undefined
      if (skillName) pending.set(input.callID, skillName)
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
    ): Promise<void> => {
      if (input.tool.toLowerCase() !== "skill") return
      const skillName = pending.get(input.callID)
      pending.delete(input.callID)
      if (!skillName) return

      const skill = mergedSkills.find(
        (s) => s.name.toLowerCase() === skillName.toLowerCase(),
      )
      const memoryTags = skill?.memoryTags ?? []

      log(`[${HOOK_NAME}] Skill invoked`, { skillName, memoryTags })
      writeSkillUsage({ skillName, sessionID: input.sessionID, memoryTags })
    },
  }
}
