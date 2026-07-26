// Compact once-per-session usage guidance (codex usage_hint parity) injected on the first
// before_agent_start. Kept short so it never crowds the model's working context.
export const TASK_USAGE_GUIDANCE = [
  "<omo-senpi-task>",
  "You can delegate work to background subagents with the task tool family:",
  "- task({ prompt, category|subagent_type, run_in_background }) spawns one child; task({ tasks:[...], run_in_background:true }) fans out a batch.",
  "- /tasks shows this session's child tasks; task_output immediately peeks a child's status or transcript (use mode:\"tail\" for recent output); task_send({ deliver_as:\"interrupt\" }) parks one, while task_cancel ends it.",
  "- Team mail is injected into recipient sessions. Use task_send for updates, then end your turn; injected mail revives resident members with follow-up work.",
  "Background tasks notify you on completion with their final result; prefer them for parallelizable or long-running work.",
  "</omo-senpi-task>",
].join("\n")

// Track that guidance has been delivered once per session id so a session_start re-fire never repeats
// it. Returns true the first time a given session should receive the guidance.
export function createOncePerSessionGuard(): (sessionId: string) => boolean {
  const seen = new Set<string>()
  return (sessionId: string): boolean => {
    if (seen.has(sessionId)) return false
    seen.add(sessionId)
    return true
  }
}
