import type { BeforeAgentStartHandlerOptions } from "../../extension/types"

/** The advisor needs the loop side's startup event and UI; senpi drops it from a hand, which then never spawns its git checks. */
export const INIT_DEEP_ADVISOR_SIDE: BeforeAgentStartHandlerOptions = { runs: "brain" }
