import type * as Root from "@oh-my-opencode/telemetry-core"

import type * as Runtime from "../../src/types"

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const assertExact = <T extends true>(value: T): T => value

export const sameEvents = assertExact<Exact<Root.TelemetryDiagnosticEvent, Runtime.TelemetryDiagnosticEvent>>(true)
export const sameInputKeys = assertExact<Exact<keyof Root.TelemetryDiagnosticInput, keyof Runtime.TelemetryDiagnosticInput>>(true)
export const sameEntryKinds = assertExact<Exact<Root.TelemetrySpoolEntryKind, Runtime.TelemetrySpoolEntryKind>>(true)

export function purgeDetail(diagnostic: Root.TelemetryDiagnosticInput): string | undefined {
  switch (diagnostic.event) {
    case "telemetry_spool_purge_failed":
      return diagnostic.errorCode
    case "telemetry_spool_purge_skipped":
      return diagnostic.entryKind
    case "telemetry_spool_purge_refused":
      return diagnostic.source
    default:
      return undefined
  }
}

export const failed: Root.TelemetryDiagnosticInput = { event: "telemetry_spool_purge_failed", source: "otlp", errorCode: "EACCES" }
export const skipped: Root.TelemetryDiagnosticInput = { event: "telemetry_spool_purge_skipped", source: "otlp", entryKind: "symlink" }
