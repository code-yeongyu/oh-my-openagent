import type { PluginInput } from "@opencode-ai/plugin"
import type { AvailableSkill } from "../../agents/dynamic-agent-prompt-builder"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared"
import { buildReminderMessage } from "./formatter"

/**
 * Target agents that should receive category+skill reminders.
 * These are orchestrator agents that delegate work to specialized agents.
 */
const TARGET_AGENTS = new Set([
  "sisyphus",
  "sisyphus-junior",
  "atlas",
])

/**
 * Tools that indicate the agent is doing work that could potentially be delegated.
 * When these tools are used, we remind the agent about the category+skill system.
 */
const DELEGATABLE_WORK_TOOLS = new Set([
  "edit",
  "write",
  "bash",
  "read",
  "grep",
  "glob",
])

/**
 * Tools that indicate the agent is already using delegation properly.
 */
const DELEGATION_TOOLS = new Set([
   "task",
   "call_omo_agent",
])

interface ToolExecuteInput {
  tool: string
  sessionID: string
  callID: string
  agent?: string
}

interface ToolExecuteOutput {
  title: string
  output: string
  metadata: unknown
}

interface SessionState {
  delegationUsed: boolean
  reminderShown: boolean
  toolCallCount: number
}

export function createCategorySkillReminderHook(
  _ctx: PluginInput,
  availableSkills: AvailableSkill[] = []
) {
  const sessionStates = new Map<string, SessionState>()
  const reminderMessage = buildReminderMessage(availableSkills)

  function getOrCreateState(sessionID: string): SessionState {
    if (!sessionStates.has(sessionID)) {
      sessionStates.set(sessionID, {
        delegationUsed: false,
        reminderShown: false,
        toolCallCount: 0,
      })
    }
    return sessionStates.get(sessionID)!
  }

  function isTargetAgent(sessionID: string, inputAgent?: string): boolean {
    const agent = getSessionAgent(sessionID) ?? inputAgent
    if (!agent) return false
    const agentLower = agent.toLowerCase()
    return (
      TARGET_AGENTS.has(agentLower) ||
      agentLower.includes("sisyphus") ||
      agentLower.includes("atlas")
    )
  }

  const toolExecuteAfter = async (input: ToolExecuteInput, output: ToolExecuteOutput) => {
    const { tool, sessionID } = input
    const toolLower = tool.toLowerCase()

    if (!isTargetAgent(sessionID, input.agent)) {
      return
    }

    const state = getOrCreateState(sessionID)

    if (DELEGATION_TOOLS.has(toolLower)) {
      state.delegationUsed = true
      log("[category-skill-reminder] Delegation tool used", { sessionID, tool })
      return
    }

    if (!DELEGATABLE_WORK_TOOLS.has(toolLower)) {
      return
    }

    state.toolCallCount++

    if (state.toolCallCount >= 3 && !state.delegationUsed && !state.reminderShown) {
      output.output += reminderMessage
      state.reminderShown = true
      log("[category-skill-reminder] Reminder injected", {
        sessionID,
        toolCallCount: state.toolCallCount,
      })
    }
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        sessionStates.delete(sessionInfo.id)
      }
    }

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined
      if (sessionID) {
        sessionStates.delete(sessionID)
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}
