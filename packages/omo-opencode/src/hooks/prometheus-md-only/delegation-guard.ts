import { getAgentConfigKey } from "../../shared/agent-display-names"
import { HOOK_NAME, PLANNING_CONTEXT_CLOSE, PLANNING_CONTEXT_OPEN } from "./constants"

/** First line of every prompt Prometheus sends to a read-only consultant; the parent can match it exactly. */
export const READ_ONLY_CONSULT_MARKER = "[prometheus:read-only-consult]"

export const PROMETHEUS_DELEGATION_REFUSED = "PROMETHEUS_IMPLEMENTATION_DELEGATION_REFUSED"

const READ_ONLY_CONSULTANTS: ReadonlySet<string> = new Set(["explore", "librarian", "oracle", "metis", "momus"])

export type PrometheusDelegation =
  | { readonly kind: "consult"; readonly agent: string }
  | { readonly kind: "implementation"; readonly target: string }

export class PrometheusImplementationDelegationError extends Error {
  readonly code = PROMETHEUS_DELEGATION_REFUSED
  readonly target: string

  constructor(target: string) {
    super(
      `[${HOOK_NAME}] ${PROMETHEUS_DELEGATION_REFUSED}: Prometheus plans; it does not delegate implementation ` +
      `(target: ${target}). Record the work as a todo in the plan; it runs when the user starts /ulw-execute.`,
    )
    this.target = target
  }
}

/** A category always spawns an executor; only a named read-only agent is a consultation. */
export function classifyPrometheusDelegation(args: Record<string, unknown>): PrometheusDelegation {
  const category = typeof args.category === "string" ? args.category.trim() : ""
  if (category) return { kind: "implementation", target: `category:${category}` }
  const agent = typeof args.subagent_type === "string" ? getAgentConfigKey(args.subagent_type) : ""
  if (agent && READ_ONLY_CONSULTANTS.has(agent)) return { kind: "consult", agent }
  return { kind: "implementation", target: agent ? `agent:${agent}` : "(no target)" }
}

export const READ_ONLY_CONSULT_PREAMBLE = `${READ_ONLY_CONSULT_MARKER}
${PLANNING_CONTEXT_OPEN}
You are a read-only consultant for a planning agent. Read, search and analyze; do not change files or system state.
Report your findings and recommendations back to the planner.
${PLANNING_CONTEXT_CLOSE}

`

export function guardPrometheusDelegation(args: Record<string, unknown>, prompt: string): string {
  const delegation = classifyPrometheusDelegation(args)
  if (delegation.kind === "implementation") throw new PrometheusImplementationDelegationError(delegation.target)
  return prompt.startsWith(READ_ONLY_CONSULT_MARKER) ? prompt : READ_ONLY_CONSULT_PREAMBLE + prompt
}
