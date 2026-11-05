import type { SenpiExtensionAPI } from "../../extension/types"

export const BROWSER_STOP_RPC = "omo.browser.stop"

/**
 * What the user did about browser use in the session a bridge serves: the app's Stop, and the user's next message that
 * clears it. A hand of a split session gets neither as a host event, so its composition passes the scope's own source.
 */
export interface BrowserBridgeLifecycleSource {
  onStop(listener: () => void): void
  onUserMessage(listener: () => void): void
}

/** Today's sources on a fused session or the loop side: the Stop request, and a non-extension `input` (loop side only). */
export function hostBrowserBridgeLifecycle(pi: SenpiExtensionAPI): BrowserBridgeLifecycleSource {
  return {
    onStop: (listener) =>
      pi.rpc?.handle?.(BROWSER_STOP_RPC, () => {
        listener()
        return { stopped: true }
      }),
    onUserMessage: (listener) =>
      pi.on("input", (payload: unknown) => {
        const source = (payload as { source?: unknown } | null)?.source
        if (source !== "extension") listener()
        return undefined
      }, { runs: "brain" }),
  }
}
