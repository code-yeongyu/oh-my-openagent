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

  test("an app that activated before start and registered again inside the recording is judged from start", () => {
    const summary = summarize(cleanRun([quietFailure, { ...activation, t: 900 }, { ...reRegistered, t: 2_500 }]))
    expect(summary.faults).toEqual([
      "dialog: window observer for pid 300 was missing after the app activated (it had failed as accessory; 1500 ms without one inside the recording)",
    ])
  })

  test("an app that activated before start and never registered again is blind for the whole recording", () => {
    expect(summarize(cleanRun([quietFailure, { ...activation, t: 900 }])).faults).toEqual([
      "dialog: window observer for pid 300 was missing after the app activated (it had failed as accessory; 2000 ms without one inside the recording)",
    ])
  })

  test("an app that activated and registered again before start has no gap inside the recording", () => {
    expect(summarize(cleanRun([quietFailure, { ...activation, t: 700 }, { ...reRegistered, t: 800 }])).faults).toEqual(
      [],
    )
  })

  test("a registration on activation that failed again, now as a regular app, is counted once", () => {
    const failedAgain = {
      ...quietFailure,
      t: 2_500,
      origin: "activation",
      policy: "regular",
      attempts: 10,
      regular: true,
    } as const
    expect(summarize(cleanRun([quietFailure, activation, failedAgain])).faults).toEqual([
      "dialog: window observer for pid 300 was missing after the app activated (it had failed as accessory; 2000 ms without one inside the recording)",
    ])
  })

  // A quiet failure covers only the window from that failure until the app registers again; it is never a whole-run
  // flag on the pid. Gaps before it, and gaps after its window closed, are judged on their own.
  test("a regular failure before the pid's first quiet failure stays a fault", () => {
    const regularFailure = {
      ...quietFailure,
      t: 1_200,
      origin: "launch",
      policy: "regular",
      attempts: 10,
      regular: true,
      since: 1_000,
    } as const
    const lateQuietFailure = { ...quietFailure, t: 1_801, origin: "activation", since: 1_801 } as const
    expect(summarize(cleanRun([regularFailure, { ...activation, t: 1_800 }, lateQuietFailure])).faults).toEqual([
      "dialog: window observer for pid 300 did not register after 10 attempts (AX cannotComplete)",
    ])
  })

  test("a late registration before the pid's first quiet failure stays a fault", () => {
    const late = { ...reRegistered, t: 1_500, origin: "launch", attempts: 4, since: 1_200 } as const
    expect(summarize(cleanRun([late, { ...quietFailure, t: 2_500, since: 2_500 }])).faults).toEqual([
      "dialog: window observer for pid 300 registered only after 4 attempts (300 ms without one inside the recording)",
    ])
  })

  test("a gap after the quiet failure's window closed is judged on its own", () => {
    const closedBeforeStart = [quietFailure, { ...activation, t: 700 }, { ...reRegistered, t: 800 }]
    const laterFailure = {
      ...quietFailure,
      t: 2_500,
      origin: "activation",
      policy: "regular",
      attempts: 10,
      regular: true,
      since: 2_000,
    } as const
    expect(summarize(cleanRun([...closedBeforeStart, laterFailure])).faults).toEqual([
      "dialog: window observer for pid 300 did not register after 10 attempts (AX cannotComplete)",
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
