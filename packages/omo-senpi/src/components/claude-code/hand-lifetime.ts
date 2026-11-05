import type { BeforeAgentStartHandlerOptions } from "../../extension/types"

/** The provider's turns run on the loop side, so the executable is fetched there; senpi drops this from a hand. */
export const CLAUDE_CODE_TURN_SIDE: BeforeAgentStartHandlerOptions = { runs: "brain" }
