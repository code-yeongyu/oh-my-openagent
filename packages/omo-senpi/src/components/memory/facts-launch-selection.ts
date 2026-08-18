// Launch-time read of the failure ledger.
//
// FAIL-CLOSED: `readFailures` throws `FactsFailuresCorruptError` on a ledger it cannot vouch
// for, and this module turns that into a REFUSAL to launch plus a warning. Degrading to
// "no failures recorded" would relaunch every parked batch forever, which is precisely the
// incident (1088 attempts on one digest) the ledger exists to prevent.

import { FactsFailuresCorruptError, type FactsFailuresFile } from "@oh-my-opencode/memory-core"

/** The read slice of `FactsFailureStore`; test doubles implement just this. */
export interface FactsFailureReadPort {
  readFailures(): Promise<FactsFailuresFile>
}

export type FactsFailuresRead =
  | { readonly ok: true; readonly failures: FactsFailuresFile }
  | { readonly ok: false }

export function hasFailureReader(candidate: unknown): candidate is FactsFailureReadPort {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as { readFailures?: unknown }).readFailures === "function"
  )
}

/** Reads the ledger ONCE per launch attempt. A corrupt ledger returns `ok: false`. */
export async function readLaunchableFailures(
  port: FactsFailureReadPort,
  warn: (message: string, fields: Readonly<Record<string, unknown>>) => void,
): Promise<FactsFailuresRead> {
  try {
    return { ok: true, failures: await port.readFailures() }
  } catch (error) {
    warn("facts failure ledger is unreadable; refusing to launch", {
      error: error instanceof Error ? error.name : "unknown",
      detail: error instanceof Error ? error.message : String(error),
      corrupt: error instanceof FactsFailuresCorruptError,
    })
    return { ok: false }
  }
}
