/**
 * Types for agent-skill-reminder hook
 */

export interface AgentSkillReminderState {
  /** Sessions that have already received skill reminder */
  remindedSessions: Set<string>
}

export interface ChatMessageInput {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  messageID?: string
}

export interface ChatMessageOutput {
  message: Record<string, unknown>
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
}
