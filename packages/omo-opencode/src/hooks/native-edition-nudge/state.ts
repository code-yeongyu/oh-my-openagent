import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { NUDGE_STATE_VERSION, type NudgeState, type NudgeStateRead } from "./types"

export const NUDGE_STATE_FILE = "native-nudge.json"

export type NudgeStateStore = {
  readonly read: () => NudgeStateRead
  readonly write: (state: NudgeState) => boolean
  readonly probeWritable: () => boolean
}

function isDecision(value: unknown): value is NudgeState["decision"] {
  return value === "none" || value === "snoozed" || value === "never" || value === "migrated"
}

function isEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

export function parseNudgeState(raw: string): NudgeStateRead {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return "corrupt"
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return "corrupt"
  const record = parsed as Record<string, unknown>
  if (!isDecision(record["decision"])) return "corrupt"
  if (!isEpoch(record["nextEligibleAt"])) return "corrupt"
  const autoShows = record["autoShows"]
  return {
    schemaVersion: typeof record["schemaVersion"] === "number" ? record["schemaVersion"] : NUDGE_STATE_VERSION,
    autoShows: typeof autoShows === "number" && Number.isSafeInteger(autoShows) && autoShows >= 0 ? autoShows : 0,
    lastShownAt: isEpoch(record["lastShownAt"]) ? record["lastShownAt"] : null,
    nextEligibleAt: record["nextEligibleAt"],
    decision: record["decision"],
    decidedAt: isEpoch(record["decidedAt"]) ? record["decidedAt"] : null,
    writtenBy: typeof record["writtenBy"] === "string" ? record["writtenBy"] : "unknown",
  }
}

export function createNudgeStateStore(stateDir: string): NudgeStateStore {
  const path = join(stateDir, NUDGE_STATE_FILE)
  return {
    read: () => {
      let raw: string
      try {
        raw = readFileSync(path, "utf8")
      } catch {
        return "missing"
      }
      return parseNudgeState(raw)
    },
    write: (state) => {
      try {
        mkdirSync(stateDir, { recursive: true })
        writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
        return true
      } catch {
        return false
      }
    },
    // Probing with a real write is the only honest answer: a directory can exist and still reject
    // a write, and a nudge that shows without being able to record itself reappears every session.
    probeWritable: () => {
      const probe = join(stateDir, `.${NUDGE_STATE_FILE}.probe`)
      try {
        mkdirSync(stateDir, { recursive: true })
        writeFileSync(probe, "", { mode: 0o600 })
      } catch {
        return false
      }
      try {
        unlinkSync(probe)
      } catch {
        /* the probe file is disposable; failing to remove it does not make the dir unwritable */
      }
      return true
    },
  }
}
