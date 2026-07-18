// Compact once-per-session usage guidance (codex usage_hint parity) injected on the first
// before_agent_start. Kept short so it never crowds the model's working context.
export const TASK_USAGE_GUIDANCE = [
  "<omo-senpi-task>",
  "You can delegate work to background subagents with the task tool family:",
  "- task({ prompt, category|subagent_type, run_in_background }) spawns one child; task({ tasks:[...], run_in_background:true }) fans out a batch.",
  "- /tasks shows this session's child tasks; task_output reads a child's transcript; task_send({ deliver_as:\"interrupt\" }) parks one, while task_cancel ends it.",
  "- team_wait({ team_run_id?, from?, timeout_ms? }) blocks on the durable pull inbox; members use the same tool inside their scoped extension.",
  "Background tasks notify you on completion; prefer them for parallelizable or long-running work.",
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
