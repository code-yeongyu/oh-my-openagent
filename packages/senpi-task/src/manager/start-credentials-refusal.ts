import { RunnerError } from "../runners/in-process/runner-error"
import type { ResolvedModelRecord, TaskRecord } from "../state"
import { classifyStartCause, type StartCause } from "./start-failure-cause"

/** The start refusal that says the child's provider cannot authenticate (#10806), or undefined for any other failure. */
export function startCredentialsRefusal(error: unknown): StartCause | undefined {
  if (!RunnerError.is(error) || error.failure.kind !== "child-prompt-failed" || error.failure.reason !== undefined) return undefined
  const cause = classifyStartCause(error.failure.cause)
  return cause?.cause_class === "credentials_missing" ? cause : undefined
}

/** The chain left after a credential refusal: every rung on the refusing provider would be refused the same way. */
export function chainWithoutRefusingProvider(
  record: Pick<TaskRecord, "fallback_models" | "resolved_model">,
  refusal: StartCause,
): readonly ResolvedModelRecord[] {
  const chain = record.fallback_models ?? []
  const provider = refusal.provider ?? record.resolved_model?.provider
  return provider === undefined ? chain : chain.filter((model) => model.provider !== provider)
}
