import type { BeforeAgentStartHandlerOptions } from "../../extension/types"

/** The footer badge needs the loop side's events and UI; senpi drops it from a hand and keeps it on a fused session. */
export const NATIVE_BADGE_HANDLER_SIDE: BeforeAgentStartHandlerOptions = { runs: "brain" }
