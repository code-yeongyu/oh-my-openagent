import type { BeforeAgentStartHandlerOptions } from "../../extension/types"

/** The conditional skill feeds the loop side's skills index; senpi drops this from a hand. x_search itself runs on both. */
export const X_SEARCH_SKILL_SIDE: BeforeAgentStartHandlerOptions = { runs: "brain" }
