import { isPlainRecord } from "@oh-my-opencode/utils/record-type-guard"

import type { applyMemoryFacts } from "../memory/facts-apply-runtime"
import type { reconcileAppliedFactsBatches } from "../memory/facts-applied-reconcile"
import { reinstallStep } from "../reinstall/reinstall-step"
import type {
  applyRetainedScan,
  claimOnboardingOwned,
  migrationFactsFromScan,
  onboardingHistorySummary,
  onboardingScanContext,
  readOnboardingState,
  runOnboardingScan,
} from "./scan-runtime"
import type { executeOnboardingSessionHistory } from "./session-history-tool-runtime"
import type { TuiMemoryToolsRuntime } from "./tui-memory-tools"
import type { runTuiOnboardingScan } from "./tui-scan-runtime"
import type { createOnboardingUnderstandingHandlers } from "./understand-component"

declare const OMO_SENPI_BUNDLED: boolean

/** The built runtime sits beside `omo.js`, so the entry bundle carries none of `omo setup`. */
export const ONBOARDING_SCAN_RUNTIME_FILE = "omo-onboarding-scan.js"

export interface OnboardingScanRuntime extends TuiMemoryToolsRuntime {
  readonly runOnboardingScan: typeof runOnboardingScan
  readonly applyRetainedScan: typeof applyRetainedScan
  readonly readOnboardingState: typeof readOnboardingState
  readonly claimOnboardingOwned: typeof claimOnboardingOwned
  readonly migrationFactsFromScan: typeof migrationFactsFromScan
  readonly onboardingScanContext: typeof onboardingScanContext
  readonly createOnboardingUnderstandingHandlers: typeof createOnboardingUnderstandingHandlers
  readonly onboardingHistorySummary: typeof onboardingHistorySummary
  readonly runTuiOnboardingScan: typeof runTuiOnboardingScan
  readonly executeOnboardingSessionHistory: typeof executeOnboardingSessionHistory
  readonly applyMemoryFacts: typeof applyMemoryFacts
  readonly reconcileAppliedFactsBatches: typeof reconcileAppliedFactsBatches
}

/**
 * Why the lazy onboarding runtime is unavailable: the missing artifact and the remedy, from fixed words. The import
 * error is never shown, because it names local paths (#15352); clients and the model read this text.
 * The artifact is spelled out instead of reusing ONBOARDING_SCAN_RUNTIME_FILE: a single use lets the bundler inline
 * that name into `new URL(...)` below, which is how the dead-file check sees the sidecar as reachable.
 */
export function onboardingRuntimeUnavailable(): string {
  return `The onboarding runtime (extensions/omo-onboarding-scan.js) could not load. Part of this omo installation is missing; ${reinstallStep()}, then start a new session.`
}

export async function loadOnboardingScanRuntime(): Promise<OnboardingScanRuntime> {
  const bundled = typeof OMO_SENPI_BUNDLED !== "undefined" && OMO_SENPI_BUNDLED
  const loaded: unknown = await import(
    new URL(bundled ? ONBOARDING_SCAN_RUNTIME_FILE : "scan-runtime.ts", import.meta.url).href
  )
  if (!isPlainRecord(loaded)) throw new Error("onboarding scan runtime did not load")
  const missing = RUNTIME_EXPORTS.filter((name) => typeof loaded[name] !== "function")
  if (missing.length > 0) throw new Error(`onboarding scan runtime is missing ${missing.join(", ")}`)
  return loaded as unknown as OnboardingScanRuntime
}

const RUNTIME_EXPORTS: readonly (keyof OnboardingScanRuntime)[] = [
  "runOnboardingScan",
  "migrationFactsFromScan",
  "applyRetainedScan",
  "createOnboardingUnderstandingHandlers",
  "onboardingHistorySummary",
  "onboardingScanContext",
  "readOnboardingState",
  "claimOnboardingOwned",
  "runTuiOnboardingScan",
  "executeOnboardingSessionHistory",
  "applyMemoryFacts",
  "reconcileAppliedFactsBatches",
  "executeOnboardingUnderstand",
  "executeOnboardingMemoryApply",
]
