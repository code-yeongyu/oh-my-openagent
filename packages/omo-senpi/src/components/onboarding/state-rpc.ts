import type { SenpiExtensionAPI } from "../../extension/types"
import type { ClaimOwnerSeams } from "./claim-owner"
import { loadOnboardingScanRuntime } from "./scan-component"

export const ONBOARDING_STATE_GET_RPC_METHOD = "omo.onboarding.state.get"
export const ONBOARDING_STATE_COMPLETE_RPC_METHOD = "omo.onboarding.state.complete"
export const ONBOARDING_STATE_RESET_RPC_METHOD = "omo.onboarding.state.reset"

/**
 * The one install-wide onboarding state (`onboarding/state.ts`) the TUI and RPC clients share.
 * A TUI claim is `inProgress`, never `completed`; completion is written when the TUI's onboarding
 * turn finishes or a client calls `complete`, and a claim released later never erases it.
 */
export interface OnboardingStateResponse {
  readonly completed: boolean
  /** ISO time onboarding finished; null when it has not. */
  readonly completedAt: string | null
  /** An onboarding run holds the claim and has not finished. */
  readonly inProgress: boolean
}

export interface OnboardingStateStore {
  readonly stateDir: string
  completeOnboarding(stateDir: string): void
  resetOnboarding(stateDir: string): void
  /** Clears this process's own onboarding run so its next prompt can onboard again. */
  onReset(): void
  /** Identity readers for judging a held claim's owner; defaults to the real process table. */
  readonly claimOwnerSeams?: ClaimOwnerSeams
}

export function registerOnboardingStateRpc(pi: SenpiExtensionAPI, store: OnboardingStateStore): void {
  const handle = pi.rpc?.handle
  if (handle === undefined) return
  // The marker reader ships in the onboarding-scan sidecar; the writes stay here, synchronous, so a
  // complete or reset lands before the sidecar is even asked for.
  const read = async (): Promise<OnboardingStateResponse> => {
    const { completedAt, inProgress } = await (await loadOnboardingScanRuntime()).readOnboardingState(store.stateDir, store.claimOwnerSeams)
    return { completed: completedAt !== null, completedAt, inProgress }
  }
  handle(ONBOARDING_STATE_GET_RPC_METHOD, read)
  handle(ONBOARDING_STATE_COMPLETE_RPC_METHOD, () => {
    store.completeOnboarding(store.stateDir)
    return read()
  })
  handle(ONBOARDING_STATE_RESET_RPC_METHOD, () => {
    store.resetOnboarding(store.stateDir)
    store.onReset()
    return read()
  })
}
