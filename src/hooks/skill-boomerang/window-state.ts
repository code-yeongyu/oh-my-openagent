export const MAX_WINDOW_TOOL_CALLS = 30

export interface L1Capture {
  tool: string
  target: string
}

export interface SkillWindow {
  skillName: string
  memoryTags: string[]
  callID: string
  windowStart: number
  toolCalls: L1Capture[]
}

export interface SessionState {
  activeWindow: SkillWindow | null
  flushed: Set<string>
}

export function idempotencyKey(sessionID: string, w: SkillWindow): string {
  return `${sessionID}:${w.skillName}:${w.windowStart}`
}
