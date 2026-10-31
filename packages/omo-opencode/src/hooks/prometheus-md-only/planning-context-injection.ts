import { PLANNING_CONSULT_WARNING, PLANNING_CONTEXT_OPEN } from "./constants"

/**
 * Dispatch-side injection guard for issue #6291.
 *
 * The prometheus-md-only hook injects the planning warning via
 * `tool.execute.before`, but OpenCode executes tools with its own original
 * args reference, so replacing `output.args` in the hook output can be
 * silently dropped: the hook logs success while the child receives the
 * original prompt. Task dispatch paths (`task`, `call_omo_agent`) call this
 * helper before launching the child so the planning context is guaranteed to
 * reach the dispatched prompt.
 *
 * Idempotent via the PLANNING_CONTEXT_OPEN marker: if the hook-level
 * injection ever does propagate, the marker is already present and this
 * helper leaves the prompt unchanged.
 */
export function injectPlanningContextIfMissing(prompt: string): string {
  if (prompt.includes(PLANNING_CONTEXT_OPEN)) return prompt
  return PLANNING_CONSULT_WARNING + prompt
}
