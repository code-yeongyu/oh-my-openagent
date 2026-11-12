import { describe, expect, test } from "bun:test"

import { type SentinelEvent, SIGNALS, type Signal, parseEvents, summarize, verdict } from "./summary.ts"

const USER_PID = 100
const TARGET_PID = 200
const START = 1_000
const STOP = 3_000

// A clean recording: every detector armed, a baseline sample for every sampled signal, a 20 Hz sampler that never
// stalls, a typist whose field always holds exactly what it sent, and a final field read after the last keystroke.
function cleanRun(extra: readonly SentinelEvent[] = []): SentinelEvent[] {
  const events: SentinelEvent[] = [{ t: 0, kind: "context", userPid: USER_PID, targetPids: [TARGET_PID] }]
  for (const signal of SIGNALS) events.push({ t: 1, kind: "armed", signal, via: "test" })
  events.push(
    { t: 10, kind: "focus", via: "sample", value: "typist/field" },
    { t: 10, kind: "order", windows: ["typist#1", "target#2", "other#3"] },
    { t: 10, kind: "pointer", via: "sample", x: 400, y: 300 },
    { t: 10, kind: "clipboard", changeCount: 7 },
    { t: 10, kind: "space", via: "sample", value: "space-1" },
    { t: 10, kind: "activation", via: "sample", pid: USER_PID },
  )
  let typed = ""
  for (let index = 0; index < 4; index++) {
    const at = 500 + index * 1_000
    const char = "abcd"[index] ?? ""
    events.push({ t: at, kind: "typed", index, char })
    typed += char
    events.push({ t: at + 40, kind: "field", text: typed, final: false })
  }
  for (let t = 0; t <= 4_000; t += 50) events.push({ t, kind: "tick" })
  events.push({ t: START, kind: "start" }, { t: STOP, kind: "stop" })
  events.push({ t: 3_600, kind: "field", text: typed, final: true })
  return [...events, ...extra].sort((a, b) => a.t - b.t)
}

const happened = (events: readonly SentinelEvent[]): Signal[] =>
  SIGNALS.filter((signal) => summarize(events).signals[signal].signal === "happened")

describe("disturbance sentinel summary", () => {
  test("a null run reads none on all eight signals with no fault", () => {
    const summary = summarize(cleanRun())
    expect(summary.faults).toEqual([])
    for (const signal of SIGNALS) expect(summary.signals[signal]).toEqual({ signal: "none", firstAt: null, count: 0 })
    expect(verdict(summary)).toBe("clean")
  })

  test("exports the eight signal ids in the shared column order", () => {
    expect(SIGNALS).toEqual([
      "key_focus",
      "window_raised",
      "typing",
      "pointer",
      "clipboard",
      "space",
      "dialog",
      "activation",
    ])
  })

  test("key_focus: a focus notification on the user's app happened", () => {
    const events = cleanRun([{ t: 1_500, kind: "focus", via: "notification", value: "typist/other" }])
    expect(happened(events)).toEqual(["key_focus"])
    expect(summarize(events).signals.key_focus).toEqual({ signal: "happened", firstAt: 1_500, count: 1 })
  })

  test("window_raised: a relative order change between two existing windows happened", () => {
    const events = cleanRun([{ t: 1_500, kind: "order", windows: ["other#3", "typist#1", "target#2"] }])
    expect(happened(events)).toEqual(["window_raised"])
  })

  test("window_raised: a window that appears or closes changes no relative order", () => {
    const events = cleanRun([
      { t: 1_500, kind: "order", windows: ["new#9", "typist#1", "target#2", "other#3"] },
      { t: 1_600, kind: "order", windows: ["typist#1", "other#3"] },
    ])
    expect(happened(events)).toEqual([])
  })

  test("typing: a character the typist sent that never reached its field happened", () => {
    const lossy = cleanRun().map((event) =>
      event.kind === "field" && event.t >= 1_540 ? { ...event, text: event.text.replace("b", "") } : event,
    )
    expect(happened(lossy)).toEqual(["typing"])
    expect(summarize(lossy).signals.typing.firstAt).toBe(2_540)
  })

  test("typing: an extra character in the field happened", () => {
    const events = cleanRun([{ t: 1_700, kind: "field", text: "abX", final: false }])
    expect(happened(events)).toEqual(["typing"])
  })

  test("typing: a final read that misses the last keystroke happened", () => {
    const events = cleanRun().map((event) =>
      event.kind === "field" && event.final ? { ...event, text: "abc" } : event,
    )
    expect(happened(events)).toEqual(["typing"])
    expect(summarize(events).signals.typing.firstAt).toBe(3_600)
  })

  test("pointer: a tapped move happened even when the position read is unchanged", () => {
    const events = cleanRun([{ t: 1_500, kind: "pointer", via: "tap", x: 400, y: 300 }])
    expect(happened(events)).toEqual(["pointer"])
  })

  test("pointer: a sampled position change happened", () => {
    const events = cleanRun([{ t: 1_500, kind: "pointer", via: "sample", x: 450, y: 300 }])
    expect(happened(events)).toEqual(["pointer"])
  })

  test("clipboard: a pasteboard change count increment happened", () => {
    const events = cleanRun([{ t: 1_500, kind: "clipboard", changeCount: 8 }])
    expect(happened(events)).toEqual(["clipboard"])
  })

  test("space: an active-Space notification happened", () => {
    const events = cleanRun([{ t: 1_500, kind: "space", via: "notification", value: "space-2" }])
    expect(happened(events)).toEqual(["space"])
  })

  test("dialog: a dialog window not owned by the target happened", () => {
    const events = cleanRun([
      { t: 1_500, kind: "window_added", id: "alert#12", ownerPid: 300, role: "AXWindow", subrole: "AXDialog", layer: 0 },
    ])
    expect(happened(events)).toEqual(["dialog"])
  })

  test("dialog: a modal-panel layer window counts; the target's own sheet and a plain window do not", () => {
    const modal = { t: 1_500, kind: "window_added", id: "p#1", ownerPid: 300, role: "", subrole: "", layer: 8 } as const
    expect(happened(cleanRun([modal]))).toEqual(["dialog"])
    const ownSheet = { ...modal, id: "s#2", ownerPid: TARGET_PID, role: "AXSheet", layer: 0 }
    const plain = { ...modal, id: "w#3", role: "AXWindow", subrole: "AXStandardWindow", layer: 0 }
    expect(happened(cleanRun([ownSheet, plain]))).toEqual([])
  })

  test("activation: an application-activation notification happened", () => {
    const events = cleanRun([{ t: 1_500, kind: "activation", via: "notification", pid: 300 }])
    expect(happened(events)).toEqual(["activation"])
  })

  test("a change that is restored before stop still reads happened, with both observations counted", () => {
    const events = cleanRun([
      { t: 1_500, kind: "order", windows: ["target#2", "typist#1", "other#3"] },
      { t: 1_550, kind: "order", windows: ["typist#1", "target#2", "other#3"] },
      { t: 1_600, kind: "activation", via: "notification", pid: 300 },
      { t: 1_900, kind: "activation", via: "notification", pid: USER_PID },
    ])
    const summary = summarize(events)
    expect(summary.signals.window_raised).toEqual({ signal: "happened", firstAt: 1_500, count: 2 })
    expect(summary.signals.activation).toEqual({ signal: "happened", firstAt: 1_600, count: 2 })
    expect(verdict(summary)).toBe("disturbed")
  })

  test("changes before start set the baseline and changes after stop are ignored", () => {
    const events = cleanRun([
      { t: 900, kind: "clipboard", changeCount: 9 },
      { t: 3_200, kind: "pointer", via: "tap", x: 1, y: 1 },
    ])
    expect(happened(events)).toEqual([])
  })

  test("leaked input into the user's window counts for typing (key) and pointer (mouse)", () => {
    expect(happened(cleanRun([{ t: 1_500, kind: "leak", what: "key" }]))).toEqual(["typing"])
    expect(happened(cleanRun([{ t: 1_500, kind: "leak", what: "mouse" }]))).toEqual(["pointer"])
  })
})

describe("a failed read is never a negative", () => {
  test("a detector that never armed is a fault and the run is invalid", () => {
    const summary = summarize(cleanRun().filter((event) => !(event.kind === "armed" && event.signal === "space")))
    expect(summary.faults).toContain("space: detector never armed")
    expect(verdict(summary)).toBe("invalid")
  })

  test("a fault reported by a detector makes the run invalid", () => {
    const summary = summarize(cleanRun([{ t: 1_500, kind: "fault", signal: "pointer", detail: "tap disabled" }]))
    expect(summary.faults).toContain("pointer: tap disabled")
    expect(verdict(summary)).toBe("invalid")
  })

  test("a sampled signal with no baseline read is a fault", () => {
    const summary = summarize(cleanRun().filter((event) => event.kind !== "clipboard"))
    expect(summary.faults).toContain("clipboard: no baseline read before start")
  })

  test("a stalled sampler is a fault", () => {
    const summary = summarize(cleanRun().filter((event) => !(event.kind === "tick" && event.t > 1_200 && event.t < 1_800)))
    expect(summary.faults.some((fault) => fault.startsWith("sampler: no tick for "))).toBe(true)
  })

  test("a missing final field read is a fault", () => {
    const summary = summarize(cleanRun().filter((event) => !(event.kind === "field" && event.final)))
    expect(summary.faults).toContain("typing: no final field read after the last keystroke")
  })

  test("a recording without start or stop is a fault", () => {
    const summary = summarize(cleanRun().filter((event) => event.kind !== "stop"))
    expect(summary.faults).toContain("recording: no stop marker")
  })
})

describe("event stream parsing", () => {
  test("parses JSON lines and reports a malformed line as a fault, never as an absence", () => {
    const { events, faults } = parseEvents(
      ['{"t":1,"kind":"tick"}', "not json", '{"t":2,"kind":"nope"}', '{"t":3,"kind":"clipboard","changeCount":1}'].join(
        "\n",
      ),
    )
    expect(events).toEqual([
      { t: 1, kind: "tick" },
      { t: 3, kind: "clipboard", changeCount: 1 },
    ])
    expect(faults).toHaveLength(2)
  })
})
