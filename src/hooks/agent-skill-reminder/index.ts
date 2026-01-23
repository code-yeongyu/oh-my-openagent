/**
 * Agent Skill Reminder Hook
 *
 * Injects skill reminders when users directly switch to agents with defaultSkills.
 * This ensures users are aware of available skills even when not using delegate_task.
 *
 * Design Decision: "Reminder over Injection"
 * - Only generates reminders (not full skill content injection)
 * - Full content injection only happens via delegate_task with explicit skills parameter
 */

import type { PluginInput } from "@opencode-ai/plugin"
import { log, generateAgentSkillReminder } from "../../shared"
import {
  getSessionAgent,
  subagentSessions,
} from "../../features/claude-code-session-state"
import { isSystemDirective } from "../../shared/system-directive"
import type { ContextCollector } from "../../features/context-injector"
import { AGENTS_WITH_DEFAULT_SKILLS } from "./constants"
import type { ChatMessageInput, ChatMessageOutput } from "./types"

export * from "./constants"
export * from "./types"

/**
 * Creates the agent skill reminder hook.
 *
 * @param _ctx - Plugin input context
 * @param collector - Optional context collector for injecting reminders
 */
export function createAgentSkillReminderHook(
  _ctx: PluginInput,
  collector?: ContextCollector
) {
  // Track sessions that have already received reminders
  const remindedSessions = new Set<string>()

  return {
    "chat.message": async (
      input: ChatMessageInput,
      output: ChatMessageOutput
    ): Promise<void> => {
      const { sessionID } = input

      // Skip if already reminded in this session
      if (remindedSessions.has(sessionID)) {
        return
      }

      // Skip background task sessions (they use delegate_task which handles reminders)
      if (subagentSessions.has(sessionID)) {
        return
      }

      // Get the current agent for this session
      const currentAgent = getSessionAgent(sessionID) ?? input.agent
      if (!currentAgent) {
        return
      }

      // Check if this agent has default skills
      if (
        !AGENTS_WITH_DEFAULT_SKILLS.includes(
          currentAgent as (typeof AGENTS_WITH_DEFAULT_SKILLS)[number]
        )
      ) {
        return
      }

      // Extract prompt text to check for system directives
      const promptText = output.parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n")

      // Skip system directive messages
      if (isSystemDirective(promptText)) {
        log(`[agent-skill-reminder] Skipping system directive message`, {
          sessionID,
        })
        return
      }

      // Generate skill reminder for this agent
      const reminder = generateAgentSkillReminder(currentAgent)

      if (!reminder) {
        return
      }

      // Mark session as reminded
      remindedSessions.add(sessionID)

      // Inject reminder via context collector if available
      if (collector) {
        collector.register(sessionID, {
          id: `skill-reminder-${currentAgent}`,
          source: "agent-skill-reminder",
          content: reminder,
          priority: "high",
        })

        log(`[agent-skill-reminder] Injected skill reminder for ${currentAgent}`, {
          sessionID,
          skillCount: reminder.split("|").length - 4, // Rough count from table rows
        })
      }
    },

    /**
     * Handle session events to clean up state
     */
    event: async ({
      event,
    }: {
      event: { type: string; properties?: unknown }
    }) => {
      const props = event.properties as Record<string, unknown> | undefined

      // Clean up on session deletion
      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined
        if (sessionInfo?.id) {
          remindedSessions.delete(sessionInfo.id)
        }
      }

      // Clean up on session compaction
      if (event.type === "session.compacted") {
        const sessionID = (props?.sessionID ??
          (props?.info as { id?: string } | undefined)?.id) as string | undefined
        if (sessionID) {
          remindedSessions.delete(sessionID)
        }
      }
    },
  }
}
