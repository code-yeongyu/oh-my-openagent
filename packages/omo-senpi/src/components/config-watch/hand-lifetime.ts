import type { BeforeAgentStartHandlerOptions } from "../../extension/types"

/**
 * The close of the execution scope a registration belongs to. A hand of a split session runs one loopless runtime per
 * scope and emits no `session_shutdown`, so its composition passes the scope's own close here.
 */
export interface ConfigWatchLifecycleSource {
  onClose(listener: () => void): void
}

/** On a fused session the registration ends with `session_shutdown`, which only the loop side emits. */
export const CONFIG_WATCH_SHUTDOWN_SIDE: Pick<BeforeAgentStartHandlerOptions, "runs"> = { runs: "brain" }
