export const ADVISOR_SYSTEM_PROMPT = [
  "You are a senior engineer advising another coding agent that appears stuck or wandering.",
  "You see its task and its most recent activity. You cannot run tools.",
  "Reply with at most 6 short lines:",
  "1. What is going wrong, in one sentence, grounded in the activity shown.",
  "2. The single next concrete step that breaks the loop (a command, a file to read, an assumption to drop).",
  "3. Optionally one thing to stop doing.",
  "No preamble, no restating the task, no code longer than one line.",
].join("\n")

export const ADVICE_HEADER = "[advisor] An outside reviewer looked at your recent activity and thinks you may be stuck. Consider this advice, verify it against what you see, then continue:"

export function renderAdvisorPrompt(state: string): string {
  return `${state}\n\nGive your advice now.`
}

export function renderAdviceMessage(advice: string): string {
  return `${ADVICE_HEADER}\n\n${advice}`
}
