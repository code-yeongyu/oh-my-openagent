import { describe, expect, test } from "bun:test"

import {
  AX_READ_ERRORS,
  dialogHits,
  LANDING_MS,
  parseEvents,
  type SentinelEvent,
  summarize,
  verdict,
} from "./summary.ts"
import { cleanRun, happened, TARGET_PID } from "./summary-fixture.ts"

// The recorder reports facts about new windows, AX observer registration and its own stop; these tests own how the
// reducer judges them.

type WindowAdded = Extract<SentinelEvent, { readonly kind: "window_added" }>

const axWindow = (fields: Partial<WindowAdded> = {}): WindowAdded => ({
  t: 1_500,
  kind: "window_added",
  source: "ax",
  notification: "window",
  id: "ax:300#4",
  ownerPid: 300,
  role: "",
  subrole: "",
  layer: 0,
  axError: "success",
  axReads: 1,
  ...fields,
})

const sampled = (fields: Partial<WindowAdded> = {}): WindowAdded => ({
  t: 1_600,
  kind: "window_added",
  source: "sample",
  id: "planter#9",
  ownerPid: 300,
  role: "",
  subrole: "",
  layer: 0,
  ...fields,
})

const withStop = (fields: { readonly pendingReads?: number }): SentinelEvent[] =>
  cleanRun().map((event) => (event.kind === "stop" ? { t: event.t, kind: "stop", ...fields } : event))

describe("a new window whose attributes could not be read", () => {
  test("a timed-out AX read of a non-target window is a dialog fault, never a negative", () => {
    const summary = summarize(cleanRun([axWindow({ id: "ax:300#0", axError: "cannotComplete", axReads: 20 })]))
    expect(summary.faults).toContain("dialog: new window ax:300#0 of pid 300 was unreadable (AX cannotComplete)")
    expect(verdict(summary)).toBe("invalid")
  })

  test("a timed-out read of the target's own window is no fault, and a clean read is judged as before", () => {
    const own = axWindow({ id: "ax:200#0", ownerPid: TARGET_PID, axError: "cannotComplete", axReads: 20 })
    const plain = axWindow({ id: "ax:300#5", role: "AXWindow", subrole: "AXStandardWindow" })
    const summary = summarize(cleanRun([own, plain]))
    expect(summary.faults).toEqual([])
    expect(verdict(summary)).toBe("clean")
  })
})

describe("AX read errors of a new window: the table the recorder's raw error names are judged by", () => {
  const table: readonly (readonly [string, "ok" | "fault"])[] = [
    ["success", "ok"],
    ["noValue", "ok"],
    ["attributeUnsupported", "ok"],
    ["cannotComplete", "fault"],
    ["invalidUIElement", "fault"],
    ["failure", "fault"],
    ["apiDisabled", "fault"],
    ["notImplemented", "fault"],
    ["someFutureCode", "fault"],
  ]
  for (const [code, expected] of table) {
    test(`${code} -> ${expected}`, () => {
      const summary = summarize(cleanRun([axWindow({ axError: code })]))
      expect(summary.faults.length > 0 ? "fault" : "ok").toBe(expected)
      if (expected === "fault") expect(summary.faults[0]).toContain(`(AX ${code})`)
    })
  }

  test("the table names exactly the codes that are not faults", () => {
    const ok = Object.entries(AX_READ_ERRORS).filter(([, value]) => value === "ok")
    expect(ok.map(([code]) => code).sort()).toEqual(["attributeUnsupported", "noValue", "success"])
  })

  test("a sheet whose role read never succeeded is still a dialog, through the notification branch only", () => {
    const events = cleanRun([axWindow({ notification: "sheet", axError: "cannotComplete", axReads: 20 })])
    expect(summarize(events).faults).toEqual([])
    expect(happened(events)).toEqual(["dialog"])
    expect(dialogHits(events)).toEqual([{ branch: "notification", axReads: 20 }])
  })
})

describe("which branch of the dialog detector fired", () => {
  test("a role read, a sheet notification alone and a modal-panel layer are three different branches", () => {
    const role = axWindow({ role: "AXSheet", axReads: 3 })
    const notification = axWindow({ t: 1_550, notification: "sheet", axError: "cannotComplete", axReads: 20 })
    const layer = sampled({ layer: 8 })
    expect(dialogHits(cleanRun([role]))).toEqual([{ branch: "role", axReads: 3 }])
    expect(dialogHits(cleanRun([layer]))).toEqual([{ branch: "layer", axReads: null }])
    expect(dialogHits(cleanRun([role, notification, layer])).map((hit) => hit.branch)).toEqual([
      "role",
      "notification",
      "layer",
    ])
    expect(dialogHits(cleanRun())).toEqual([])
  })
})

describe("new-window reads still running at stop", () => {
  test("a stop marker that reports pending reads is a dialog fault, never a clean window", () => {
    const summary = summarize(withStop({ pendingReads: 2 }))
    expect(summary.faults).toContain("dialog: 2 new-window reads were still running at stop")
    expect(verdict(summary)).toBe("invalid")
  })

  test("a stop marker with no pending reads changes nothing", () => {
    expect(summarize(withStop({ pendingReads: 0 })).faults).toEqual([])
  })
})

describe("a fact the recorder did not report is a fault, not a clean read", () => {
  test("a stop marker without its pending-read count", () => {
    const summary = summarize(withStop({}))
    expect(summary.faults).toEqual(["dialog: stop marker did not report pending new-window reads"])
  })

  const { axError: _axError, ...noError } = axWindow()
  const { axReads: _axReads, ...noReads } = axWindow()
  const { notification: _notification, ...noNotification } = axWindow()
  for (const [missing, event] of [
    ["axError", noError],
    ["axReads", noReads],
    ["notification", noNotification],
  ] as const) {
    test(`an AX window event without ${missing}`, () => {
      const summary = summarize(cleanRun([event]))
      expect(summary.faults).toEqual(["dialog: AX window event ax:300#4 of pid 300 did not report its read result"])
    })
  }

  test("a sampled window carries no AX facts and is judged on its layer alone", () => {
    expect(summarize(cleanRun([sampled()])).faults).toEqual([])
  })

  test("a window event that does not say which path saw it is not an event", () => {
    const line = JSON.stringify({ t: 1, kind: "window_added", id: "w#1", ownerPid: 3, role: "", subrole: "", layer: 0 })
    expect(parseEvents(line).events).toEqual([])
    expect(parseEvents(line).faults).toHaveLength(1)
  })
})

// The typist types once a second. A final field read is judged against the keystrokes that had time to land, so a
// final read delayed into the next keystroke (by the recorder's drain) can never fake a typing disturbance.
describe("the final field read is judged against the keystrokes that had landed", () => {
  const finalAt = (t: number, text: string): SentinelEvent[] =>
    cleanRun().map((event) => (event.kind === "field" && event.final ? { ...event, t, text } : event))
  const lastKeystroke = 3_500

  test("a final read just after a keystroke may or may not hold it", () => {
    const early = lastKeystroke + LANDING_MS - 1
    expect(happened(finalAt(early, "abc"))).toEqual([])
    expect(happened(finalAt(early, "abcd"))).toEqual([])
    expect(summarize(finalAt(early, "abc")).faults).toEqual([])
  })

  test("a final read once the keystroke has landed must hold it", () => {
    expect(happened(finalAt(lastKeystroke + LANDING_MS, "abc"))).toEqual(["typing"])
  })

  test("a landed keystroke missing, or a character nobody typed, is a disturbance at any time", () => {
    expect(happened(finalAt(lastKeystroke + 50, "ab"))).toEqual(["typing"])
    expect(happened(finalAt(lastKeystroke + 50, "abcX"))).toEqual(["typing"])
  })
})

describe("AX observer registration", () => {
  const failed = (fields: { readonly pid?: number; readonly regular?: boolean; readonly t?: number } = {}) =>
    ({
      t: 500,
      kind: "observer_failed",
      pid: 300,
      axError: "cannotComplete",
      attempts: 10,
      regular: true,
      ...fields,
    }) as const

  test("a regular app outside the target that never registered is a dialog fault", () => {
    const summary = summarize(cleanRun([failed()]))
    expect(summary.faults).toEqual([
      "dialog: window observer for pid 300 did not register after 10 attempts (AX cannotComplete)",
    ])
    expect(verdict(summary)).toBe("invalid")
  })

  test("a target app, an app without a user interface, or a failure after stop is not judged", () => {
    expect(summarize(cleanRun([failed({ pid: TARGET_PID })])).faults).toEqual([])
    expect(summarize(cleanRun([failed({ regular: false })])).faults).toEqual([])
    expect(summarize(cleanRun([failed({ t: 3_500 })])).faults).toEqual([])
  })
})
