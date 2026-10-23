import { LATEST_MODEL_BY_FAMILY } from "./latest-models"
import type { ModelCapabilitiesSnapshotEntry } from "./model-capabilities/types"

// LAUNCH-GATED: the ID is provisional. Fill only from the live launch listing, never from 5.1.
// Pricing is owned by the adopted senpi catalog; omo has no price override for this model.
export const FABLE_55_LAUNCH: ModelCapabilitiesSnapshotEntry = {
  id: "claude-fable-5-5",
  family: "claude-fable",
  reasoning: undefined,
  temperature: undefined,
  toolCall: undefined,
  modalities: undefined,
  limit: {
    context: undefined,
    input: undefined,
    output: undefined,
  },
}

// Flip to true only after the live listing confirms the id. Until then no routing path may pick it
// without availability proof (a cold provider-models cache gives none).
export const FABLE_55_RELEASED = false

// LAUNCH-GATED: the 5.5 rungs carry xhigh/max carried over from 5.1, not measured on 5.5. Set
// measured to true and accepted to the efforts the live listing confirms before the release flip.
export const FABLE_55_EFFORTS: { readonly measured: boolean; readonly accepted: readonly string[] } = {
  measured: false,
  accepted: ["xhigh", "max"],
}

function isFable55Model(model: string): boolean {
  const modelId = model.split("/").pop() ?? model
  return modelId.replaceAll(".", "-") === FABLE_55_LAUNCH.id
}

export function isLaunchGatedModel(model: string): boolean {
  if (FABLE_55_RELEASED) return false
  return isFable55Model(model)
}

export type LaunchRungRejection = { readonly model: string; readonly variant: string | undefined }

const launchRungRejectionLog: LaunchRungRejection[] = []

/** Rejections recorded while building the builtin chains; a release build must record none. */
export function launchRungRejections(): readonly LaunchRungRejection[] {
  return launchRungRejectionLog
}

// A launch-gate config error must never take down plugin load: a released 5.5 rung whose effort is
// not accepted is dropped (treated as unreleased), recorded, and warned about once; the launch gate
// test fails on any recorded rejection, so the error is caught before it ships.
export function selectLaunchRungs<T extends { model: string; variant?: string }>(
  rungs: readonly T[],
  gate: { readonly released: boolean; readonly accepted: readonly string[] },
  onRejected: (rejection: LaunchRungRejection) => void,
): T[] {
  return rungs.filter((rung) => {
    if (!isFable55Model(rung.model)) return true
    if (!gate.released) return false
    if (rung.variant !== undefined && gate.accepted.includes(rung.variant)) return true
    onRejected({ model: rung.model, variant: rung.variant })
    return false
  })
}

function recordLaunchRungRejection(rejection: LaunchRungRejection): void {
  launchRungRejectionLog.push(rejection)
  console.warn(
    `[fable-55-launch] dropped a Fable 5.5 rung with effort "${rejection.variant ?? "(none)"}": not in FABLE_55_EFFORTS.accepted`,
  )
}

/**
 * The model that stands in for Fable 5.5 until it is released (its launch-day predecessor): the table entry, which stays
 * on 5.1 until after launch. Moving `LATEST_MODEL_BY_FAMILY.claudeFable` to 5.5 is the POST-launch cleanup step, after
 * FABLE_55_RELEASED flips; fable-55-launch.test.ts fails if the table names 5.5 while the release is still gated.
 */
export const FABLE_55_PREDECESSOR = LATEST_MODEL_BY_FAMILY.claudeFable

// Data-layer gate: every builtin chain, profile and default builds its 5.5 entries through these, so
// while FABLE_55_RELEASED is false no resolver (model-core, delegate-core, getFirstFallbackModel,
// senpi-task, cold/warm/null caches) can ever see the provisional id.
export function launchRungs<T extends { model: string; variant?: string }>(rungs: readonly T[]): T[] {
  return selectLaunchRungs(rungs, { released: FABLE_55_RELEASED, accepted: FABLE_55_EFFORTS.accepted }, recordLaunchRungRejection)
}

export function launchDefaultModelId(): string {
  return FABLE_55_RELEASED ? FABLE_55_LAUNCH.id : FABLE_55_PREDECESSOR
}
