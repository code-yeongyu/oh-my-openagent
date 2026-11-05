import type { BeforeAgentStartHandlerOptions } from "../../extension/types"

/**
 * The app grants a toolkit over the session host's RPC, as a loopback endpoint on the app's own machine, and
 * discovery follows the loop side's session events, so the toolkit tools and their discovery belong to the loop side
 * of a split session. senpi drops these handlers from a hand; the tools carry the same side.
 */
export const DESKTOP_TOOLKIT_SIDE = { runs: "brain" } as const satisfies BeforeAgentStartHandlerOptions
