import { readdirSync } from "node:fs"
import { join } from "node:path"
import type { TelemetryDiagnosticInput } from "@oh-my-opencode/telemetry-core"

import type { LoadSummaryRecovery } from "./session-summary-lazy-recovery"
import { purgeUnconsentedQueue, summaryDir } from "./session-summary-purge"
import type { ConsentScope } from "./session-summary-storage"

/**
 * The opt-out purge, run at registration and again at shutdown by a process that records nothing.
 *
 * 1. In the entry bundle, with node:fs only: every queued window and pending event that may never be sent is
 *    deleted, whoever wrote it, a live owner's included (its own persisted setting is off, so it would never send it).
 * 2. Only when files remain that need owner liveness to judge (an interrupted write's `.tmp`, a `.claimed-` copy),
 *    the recovery sidecar loads and removes dead owners' leftovers and registry entries. The common opted-out start
 *    loads no telemetry code.
 *
 * Consent is the caller's: the persisted setting only, never this process's own env opt-out.
 */
export function startOptOutPurge(input: {
  readonly stateDir: string
  readonly isScopeConsented: (scope: ConsentScope) => boolean
  /** True when this process's own persisted setting is off: unreadable summary files are deleted too. */
  readonly persistedOptOut?: boolean
  readonly load: LoadSummaryRecovery
  readonly isPidAlive?: (pid: number) => boolean
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
}): Promise<void> {
  const report = (error: unknown): void => {
    input.diagnostics?.({
      event: "telemetry_activity_state_write_failed",
      source: "omo-native-component",
      error,
      errorKind: error instanceof Error ? "error" : "non_error",
    })
  }
  try {
    purgeUnconsentedQueue(input.stateDir, input.isScopeConsented, { dropUnreadable: input.persistedOptOut === true })
  } catch (error) {
    report(error)
  }
  if (!hasLivenessLeftovers(input.stateDir)) return Promise.resolve()
  return input.load()
    .then((sidecar) => {
      sidecar.purgeOptedOutStorage({
        stateDir: input.stateDir,
        isScopeConsented: input.isScopeConsented,
        ...(input.isPidAlive === undefined ? {} : { isPidAlive: input.isPidAlive }),
      })
    })
    .catch(report)
}

function hasLivenessLeftovers(stateDir: string): boolean {
  const dir = summaryDir(stateDir)
  return [dir, join(dir, "pending")].some((folder) =>
    names(folder).some((name) => name.endsWith(".tmp") || name.includes(".claimed-")),
  )
}

function names(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
