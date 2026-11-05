import type { BeforeAgentStartHandlerOptions, ComponentLogger } from "../../extension/types"

/** Where this generation runs; the engine release that wires a split session's hand sets it. */
export type ConfigStartupPlacement = "fused" | "hand"

/** The notices wait for the loop side's `session_start` and UI; senpi drops this handler from a hand. */
export const CONFIG_STARTUP_NOTICE_SIDE: BeforeAgentStartHandlerOptions = { runs: "brain" }

export interface StartupNoticeLine {
  readonly message: string
  readonly type: "info" | "warning"
}

/** A hand has no loop events and no UI, so it reports what its own load found to the logger, once. */
export function logStartupNoticesOnHand(notices: readonly StartupNoticeLine[], logger: ComponentLogger): void {
  for (const notice of notices) {
    if (notice.type === "warning") logger.warn(notice.message)
    else logger.info(notice.message)
  }
}
