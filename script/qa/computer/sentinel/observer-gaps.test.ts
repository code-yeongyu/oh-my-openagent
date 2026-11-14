import { describe, expect, test } from "bun:test"

import { parseEvents, summarize, verdict } from "./summary.ts"
import { cleanRun } from "./summary-fixture.ts"

// An app whose window observer failed while it was a background agent is not judged then. If it activates inside the
// recording it had a user interface, and a sheet it showed before it registered again was invisible to every branch.

const quietFailure = {
  t: 400,
  kind: "observer_failed",
  origin: "arm",
  pid: 300,
  app: "com.example.helper",
  policy: "accessory",
  axError: "cannotComplete",
  attempts: 1,
  regular: false,
  since: 400,
} as const
const activation = { t: 1_500, kind: "activation", via: "notification", pid: 300 } as const
const reRegistered = {
  t: 2_000,
  kind: "observer_late",
  origin: "activation",
  pid: 300,
  attempts: 1,
  regular: true,
  since: 400,
} as const

describe("an app that failed registration as a background agent and later activated", () => {
  test("the gap until it registered again is a dialog fault, counted once", () => {
    const summary = summarize(cleanRun([quietFailure, activation, reRegistered]))
    expect(summary.faults).toEqual([
      "dialog: window observer for pid 300 was missing after the app activated (it had failed as accessory; 1000 ms without one inside the recording)",
    ])
    expect(verdict(summary)).toBe("invalid")
  })

  test("an app that activated and never registered again is blind until stop", () => {
    expect(summarize(cleanRun([quietFailure, activation])).faults).toEqual([
      "dialog: window observer for pid 300 was missing after the app activated (it had failed as accessory; 2000 ms without one inside the recording)",
    ])
  })

  test("a background agent that never activates, or activates after stop, is not judged", () => {
    expect(summarize(cleanRun([quietFailure])).faults).toEqual([])
    expect(summarize(cleanRun([quietFailure, { ...activation, t: 3_500 }])).faults).toEqual([])
  })

  test("an observer fact that does not say where the registration came from is not an event", () => {
    const { origin: _origin, ...noOrigin } = quietFailure
    expect(parseEvents(JSON.stringify(noOrigin)).events).toEqual([])
  })
})
