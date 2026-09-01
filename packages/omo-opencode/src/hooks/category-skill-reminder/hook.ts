import type { PluginInput } from "@opencode-ai/plugin"
import type { Message, Part } from "@opencode-ai/sdk"
import type { AvailableSkill } from "../../agents/dynamic-agent-prompt-builder"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { isRealUserTextPart, log } from "../../shared"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { buildReminderMessage } from "./formatter"

const TARGET_AGENTS = new Set([
  "sisyphus",
  "sisyphus-junior",
  "atlas",
])

const DELEGATABLE_WORK_TOOLS = new Set([
  "edit",
  "write",
  "bash",
  "read",
  "grep",
  "glob",
])

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
  reminderPending: boolean
  reminderShown: boolean
  toolCallCount: number
}

type MessageWithParts = { info: Message; parts: Part[] }

interface ReminderInjectionTarget {
  message: MessageWithParts
  messageID: string
  sessionID: string
  state: SessionState
  textPartIndex: number
}

function findLatestReminderTarget(
  messages: MessageWithParts[],
  sessionStates: Map<string, SessionState>,
): ReminderInjectionTarget | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message?.info.role !== "user") continue
    const sessionID = message.info.sessionID
    const messageID = message.info.id
    if (typeof sessionID !== "string" || typeof messageID !== "string") continue

    const state = sessionStates.get(sessionID)
    if (!state?.reminderPending || state.reminderShown || state.delegationUsed) continue

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (part && isRealUserTextPart(part)) {
        return { message, messageID, sessionID, state, textPartIndex: partIndex }
      }
    }
  }

  return undefined
}

export function createCategorySkillReminderHook(
  _ctx: PluginInput,
  availableSkills: AvailableSkill[] = [],
) {
  const sessionStates = new Map<string, SessionState>()
  const reminderMessage = buildReminderMessage(availableSkills)

  function getOrCreateState(sessionID: string): SessionState {
    if (!sessionStates.has(sessionID)) {
      sessionStates.set(sessionID, {
        delegationUsed: false,
        reminderPending: false,
        reminderShown: false,
        toolCallCount: 0,
      })
    }
    return sessionStates.get(sessionID)!
  }

  function isTargetAgent(sessionID: string, inputAgent?: string): boolean {
    const agent = getSessionAgent(sessionID) ?? inputAgent
    if (!agent) return false
    const agentKey = getAgentConfigKey(agent)
    return (
      TARGET_AGENTS.has(agentKey) ||
      agentKey.includes("sisyphus") ||
      agentKey.includes("atlas")
    )
  }

  const toolExecuteAfter = async (input: ToolExecuteInput, _output: ToolExecuteOutput) => {
    const { tool, sessionID } = input
    const toolLower = tool.toLowerCase()

    if (!isTargetAgent(sessionID, input.agent)) {
      return
    }

    const state = getOrCreateState(sessionID)

    if (DELEGATION_TOOLS.has(toolLower)) {
      state.delegationUsed = true
      state.reminderPending = false
      log("[category-skill-reminder] Delegation tool used", { sessionID, tool })
      return
    }

    if (!DELEGATABLE_WORK_TOOLS.has(toolLower)) {
      return
    }

    state.toolCallCount++

    if (
      state.toolCallCount >= 3
      && !state.delegationUsed
      && !state.reminderPending
      && !state.reminderShown
    ) {
      state.reminderPending = true
      log("[category-skill-reminder] Reminder queued", {
        sessionID,
        toolCallCount: state.toolCallCount,
      })
    }
  }

  const messagesTransform = async (
    _input: Record<string, never>,
    output: { messages: MessageWithParts[] },
  ): Promise<void> => {
    const target = findLatestReminderTarget(output.messages, sessionStates)
    if (!target) return

    target.message.parts.splice(target.textPartIndex, 0, {
      id: `prt_category_skill_reminder_${target.messageID}`,
      sessionID: target.sessionID,
      messageID: target.messageID,
      type: "text",
      text: reminderMessage,
      synthetic: true,
    })
    target.state.reminderPending = false
    target.state.reminderShown = true
    log("[category-skill-reminder] Reminder injected", {
      sessionID: target.sessionID,
    })
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionID = resolveSessionEventID(props)
      if (sessionID) {
        sessionStates.delete(sessionID)
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    "experimental.chat.messages.transform": messagesTransform,
    event: eventHandler,
  }
}
