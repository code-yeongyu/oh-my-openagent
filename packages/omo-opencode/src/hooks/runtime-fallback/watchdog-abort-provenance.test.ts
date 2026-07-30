import { describe, expect, it } from "bun:test"
import { createWatchdogAbortProvenance } from "./watchdog-abort-provenance"

describe("watchdog abort provenance", () => {
  it("#given two watchdog generations completed visibly #when newest then oldest delayed terminals arrive #then each generation is consumed once", () => {
    const sessionID = "session-two-completed-generations"
    const provenance = createWatchdogAbortProvenance()

    provenance.record(sessionID, 1)
    provenance.markCurrentCompleted(sessionID, 1)
    provenance.record(sessionID, 2)
    provenance.markCurrentCompleted(sessionID, 2)

    expect(provenance.consumeCurrent(sessionID, 2, false)).toBe(true)
    expect(provenance.consumeCurrent(sessionID, 2, false)).toBe(true)
    expect(provenance.consumeCurrent(sessionID, 2, false)).toBe(false)
  })
})
