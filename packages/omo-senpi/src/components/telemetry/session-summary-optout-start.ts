import type { TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"

import { listNames } from "./session-summary-files"
import type { LoadSummaryRecovery } from "./session-summary-lazy-recovery"
import { currentProcessOwner } from "./session-summary-owner"
import { createSummaryStorage, type ConsentScope } from "./session-summary-storage"

/**
 * Starts the opt-out purge of what dead processes left in the summary directory. The purge itself ships in the
 * recovery sidecar; an empty or missing directory has nothing to purge, so the common opted-out start loads nothing.
 */
export function startOptOutPurge(input: {
  readonly stateDir: string
  readonly isScopeConsented: (scope: ConsentScope) => boolean
  readonly load: LoadSummaryRecovery
  readonly isPidAlive?: (pid: number) => boolean
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
}): Promise<void> {
  const storage = createSummaryStorage({
    stateDir: input.stateDir,
    owner: currentProcessOwner(),
    ...(input.isPidAlive === undefined ? {} : { isPidAlive: input.isPidAlive }),
  })
  if (listNames(storage.dir).length === 0) return Promise.resolve()
  return input.load()
    .then((sidecar) => {
      sidecar.purgeOptedOutStorage(storage, input.isScopeConsented)
    })
    .catch((error: unknown) => {
      input.diagnostics?.({
        event: "telemetry_activity_state_write_failed",
        source: "omo-native-component",
        error,
        errorKind: error instanceof Error ? "error" : "non_error",
      })
    })
}
