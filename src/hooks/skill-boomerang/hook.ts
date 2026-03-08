import { log } from "../../shared/logger"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import { MAX_WINDOW_TOOL_CALLS, type SessionState, type SkillWindow, idempotencyKey } from "./window-state"
import { extractTarget } from "./target-extractor"
import { writeBoomerang } from "./memory-writer"

const HOOK_NAME = "skill-boomerang"

type ToolBeforeInput = { tool: string; callID: string; sessionID?: string }
type ToolBeforeOutput = { args: Record<string, unknown> }
type ToolAfterInput = { tool: string; sessionID: string; callID: string }
type ToolAfterOutput = { title?: string; output?: string; metadata?: unknown } | undefined

export function createSkillBoomerangHook(mergedSkills: LoadedSkill[]) {
  const sessions = new Map<string, SessionState>()
  const pending = new Map<string, { skillName: string; memoryTags: string[] }>()

  function getOrCreate(sessionID: string): SessionState {
    if (!sessions.has(sessionID)) {
      sessions.set(sessionID, { activeWindow: null, flushed: new Set() })
    }
    return sessions.get(sessionID)!
  }

  function flush(sessionID: string, state: SessionState): void {
    const w = state.activeWindow
    if (!w) return
    const key = idempotencyKey(sessionID, w)
    if (state.flushed.has(key)) return
    state.flushed.add(key)
    state.activeWindow = null
    log(`[${HOOK_NAME}] Flushing window`, { skillName: w.skillName, toolCalls: w.toolCalls.length })
    writeBoomerang({ skillName: w.skillName, memoryTags: w.memoryTags, toolCalls: w.toolCalls, sessionID })
  }

  return {
    subscriptions: ["tool.execute.before", "tool.execute.after", "event"],

    "tool.execute.before": async (input: ToolBeforeInput, output: ToolBeforeOutput): Promise<void> => {
      if (input.tool.toLowerCase() !== "skill") return
      const skillName = output.args.name as string | undefined
      if (!skillName) return
      const skill = mergedSkills.find((s) => s.name.toLowerCase() === skillName.toLowerCase())
      pending.set(input.callID, { skillName, memoryTags: skill?.memoryTags ?? [] })
    },

    "tool.execute.after": async (input: ToolAfterInput, output: ToolAfterOutput): Promise<void> => {
      const state = getOrCreate(input.sessionID)
      const tool = input.tool.toLowerCase()

      if (tool === "skill") {
        const cached = pending.get(input.callID)
        pending.delete(input.callID)
        if (!cached) return
        flush(input.sessionID, state)
        state.activeWindow = {
          skillName: cached.skillName,
          memoryTags: cached.memoryTags,
          callID: input.callID,
          windowStart: Date.now(),
          toolCalls: [],
        }
        log(`[${HOOK_NAME}] Window opened`, { skillName: cached.skillName })
        return
      }

      const w = state.activeWindow
      if (!w || w.toolCalls.length >= MAX_WINDOW_TOOL_CALLS) return
      w.toolCalls.push({ tool: input.tool, target: extractTarget(input.tool, output?.title) })
    },

    event: async (input: { event: { type: string; properties?: unknown } }): Promise<void> => {
      const props = input.event.properties as Record<string, unknown> | undefined

      if (input.event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined
        if (!sessionID) return
        const state = sessions.get(sessionID)
        if (state) flush(sessionID, state)
        return
      }

      if (input.event.type === "session.deleted") {
        const sessionID = (props?.info as { id?: string } | undefined)?.id
        if (!sessionID) return
        const state = sessions.get(sessionID)
        if (state) flush(sessionID, state)
        sessions.delete(sessionID)
        return
      }

      if (input.event.type === "session.compacted") {
        const sessionID = (props?.sessionID ?? (props?.info as { id?: string } | undefined)?.id) as string | undefined
        if (!sessionID) return
        const state = sessions.get(sessionID)
        if (state) {
          flush(sessionID, state)
          state.activeWindow = null
        }
      }
    },
  }
}
