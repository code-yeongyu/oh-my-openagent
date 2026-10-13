import type { ChildSpec, ChildSession } from "../in-process"
import { startedOnPinnedModel } from "../pinned-model-equivalence"
import { RunnerError } from "./runner-error"

/**
 * Post-start pin check (#9722). A child spec naming a canonical `provider/model` must have STARTED
 * on exactly that model; when the engine reports a different effective model the spawn fails typed
 * as model_unavailable and the caller tears the session down, so no turn ever runs on a
 * substituted route (the settings default being the historical one). A spec carrying no resolved
 * model, or a runtime that reports none, skips the assertion - the planner's resolve-or-fail gate
 * is what keeps those children honest, and fakes legitimately omit `model`.
 */
export function assertPinnedModelHonoured(spec: ChildSpec, session: ChildSession): void {
  if (spec.model === undefined) return
  const selected = spec.resolvedModel ?? parseSelectedModel(spec.selectedModel)
  if (selected === undefined) return
  const effective = session.model
  if (effective === undefined) return
  if (startedOnPinnedModel(effective, { provider: selected.provider, id: selected.model_id }, spec.model)) return
  throw new RunnerError({
    kind: "model_unavailable",
    message: `the child session started on ${effective.provider}/${effective.id} instead of the pinned ${selected.provider}/${selected.model_id}; refusing the substitution`,
  })
}

function parseSelectedModel(reference: string | undefined): { readonly provider: string; readonly model_id: string } | undefined {
  if (reference === undefined) return undefined
  const slash = reference.indexOf("/")
  if (slash <= 0 || slash === reference.length - 1) return undefined
  return { provider: reference.slice(0, slash), model_id: reference.slice(slash + 1) }
}
