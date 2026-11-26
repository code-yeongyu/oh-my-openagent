import type { InFlightReads } from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../extension/types"

/**
 * Pressure dream requests run detached from their caller. Pressure is re-checked after every settled turn
 * that follows accepted input (#15054), so a reflection or dream that pushes system/ past the target in a
 * long-lived session gets its corrective dream without waiting for the next session bind.
 */
export function createPressureDreamAdmission(options: {
  readonly request: (sessionId: string) => Promise<unknown>
  /** Whether the session's committed system/ estimate has reached the pressure target. */
  readonly reached: (sessionId: string) => Promise<boolean>
  /** The memory work the session_shutdown drain awaits; a request runs detached from its caller, so it is tracked here. */
  readonly work: InFlightReads
  readonly logger?: ComponentLogger
}) {
  const track = (task: () => Promise<unknown>): void => {
    void options.work.track(task).catch((error: unknown) => {
      options.logger?.warn("omo-senpi memory pressure dream trigger failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }
  return {
    /** The bind-time advisory found pressure: request now only when the session already accepted input. */
    requestIfAdmitted(sessionId: string, admitted: boolean): void {
      if (admitted) track(() => options.request(sessionId))
    },
    checkAfterSettle(sessionId: string): void {
      track(async () => {
        if (await options.reached(sessionId)) await options.request(sessionId)
      })
    },
  }
}
