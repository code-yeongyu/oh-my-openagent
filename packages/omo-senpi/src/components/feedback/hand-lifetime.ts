import type { BeforeAgentStartHandlerOptions } from "../../extension/types"

/** A report's session comes from the loop side's session events, where the session and its UI live; senpi drops these from a hand. */
export const FEEDBACK_SESSION_SIDE: BeforeAgentStartHandlerOptions = { runs: "brain" }
