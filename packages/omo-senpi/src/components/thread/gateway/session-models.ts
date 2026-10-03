/**
 * The model record of a gateway session (#9425): which model it runs, at which thinking level, and
 * why. `provenance` is `auto` (resolved from the connected providers because nobody chose one), `set`
 * (an explicit choice; `set_by` names whose: the connector's config, the user, or a lead session) or
 * `fallback` (the engine switched away after a provider error; `set_by` keeps the overridden choice's
 * setter and `reason` carries the error). Shared by the store worker and its callers; no sqlite here.
 */

export const MODEL_PROVENANCES = ["auto", "set", "fallback"] as const
export const MODEL_SETTERS = ["config", "user", "lead"] as const

export type ModelProvenance = (typeof MODEL_PROVENANCES)[number]
export type ModelSetter = (typeof MODEL_SETTERS)[number]

export type ModelRef = { readonly provider: string; readonly id: string }

export type ThreadModel = ModelRef & {
  readonly thinking_level: string | null
  readonly provenance: ModelProvenance
  readonly set_by: ModelSetter | null
  readonly reason: string | null
}

/**
 * A model record with its revision (#9429): every write bumps it, so a caller that read revision N
 * knows its write is the next one only while the record still reads N.
 */
export type SessionModelRecord = { readonly model: ThreadModel; readonly revision: number }

/** The `model_change` field of the milestone row a fallback switch writes. */
export type ModelChange = { readonly from: ModelRef; readonly to: ModelRef; readonly reason: string | null }

/** senpi `ModelSelectSource`: why the engine switched the session's model. */
export type ModelSelectSource = "set" | "cycle" | "restore" | "fallback" | "fallback-revert"

export type ObserveModelRequest = {
  readonly now: number
  readonly durable_id: string
  readonly to: ModelRef
  readonly from: ModelRef | null
  readonly thinking_level: string | null
  readonly source: ModelSelectSource
  readonly reason: string | null
}

export type ObserveModelResult = { readonly updated: boolean; readonly milestones: readonly { readonly binding_id: string; readonly cursor: number }[] }

export function isModelSetter(value: unknown): value is ModelSetter {
  return typeof value === "string" && (MODEL_SETTERS as readonly string[]).includes(value)
}

export function modelLabel(model: ModelRef): string {
  return `${model.provider}/${model.id}`
}

/** The human sentence of a fallback milestone row; the structured switch travels beside it as `model_change`. */
export function fallbackMilestoneText(change: ModelChange): string {
  return `switched to ${modelLabel(change.to)} after a provider error on ${modelLabel(change.from)}`
}
