import { describe, expect, test } from "bun:test"

import { type SentinelEvent, SIGNALS, type Signal, parseEvents, summarize, verdict } from "./summary.ts"
import { cleanRun, happened, TARGET_PID, USER_PID } from "./summary-fixture.ts"

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

  test("typing: a typist reset (index 0, field cleared) starts a new sequence and is no disturbance", () => {
    const events = cleanRun([
      { t: 1_200, kind: "typed", index: 0, char: "x" },
      { t: 1_240, kind: "field", text: "x", final: false },
    ]).filter((event) => !(event.kind === "typed" && event.t > 1_200) && !(event.kind === "field" && event.t > 1_240))
    const withFinal = [...events, { t: 3_600, kind: "field" as const, text: "x", final: true }]
    expect(happened(withFinal)).toEqual([])
    expect(summarize(withFinal).faults).toEqual([])
  })

  test("typing: a skipped index that is not a reset is a fault", () => {
    const events = cleanRun([{ t: 1_200, kind: "typed", index: 7, char: "x" }])
    expect(summarize(events).faults).toContain("typing: typist sent index 7 after 1")
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
    expect(summarize(events).signals.typing.firstAt).toBe(4_000)
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
      {
        t: 1_500,
        kind: "window_added",
        source: "sample",
        id: "alert#12",
        ownerPid: 300,
        role: "AXWindow",
        subrole: "AXDialog",
        layer: 0,
      },
    ])
    expect(happened(events)).toEqual(["dialog"])
  })

  test("dialog: a modal-panel layer window counts; the target's own sheet and a plain window do not", () => {
    const modal = {
      t: 1_500,
      kind: "window_added",
      source: "sample",
      id: "p#1",
      ownerPid: 300,
      role: "",
      subrole: "",
      layer: 8,
    } as const
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
    const summary = summarize(
      cleanRun().filter((event) => !(event.kind === "tick" && event.t > 1_200 && event.t < 1_800)),
    )
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

describe("sabotage: every detector can be made to miss", () => {
  const plants: Readonly<Record<Signal, SentinelEvent>> = {
    key_focus: { t: 1_500, kind: "focus", via: "notification", value: "typist/other" },
    window_raised: { t: 1_500, kind: "order", windows: ["other#3", "typist#1", "target#2"] },
    typing: { t: 1_700, kind: "field", text: "abX", final: false },
    pointer: { t: 1_500, kind: "pointer", via: "tap", x: 400, y: 300 },
    clipboard: { t: 1_500, kind: "clipboard", changeCount: 8 },
    space: { t: 1_500, kind: "space", via: "notification", value: "space-2" },
    dialog: {
      t: 1_500,
      kind: "window_added",
      source: "sample",
      id: "a#1",
      ownerPid: 300,
      role: "AXWindow",
      subrole: "AXDialog",
      layer: 0,
    },
    activation: { t: 1_500, kind: "activation", via: "notification", pid: 300 },
  }

  for (const signal of SIGNALS) {
    test(`dropping ${signal} turns its own planted disturbance into a miss and leaves the run valid`, () => {
      const events = cleanRun([plants[signal]])
      expect(summarize(events).signals[signal].signal).toBe("happened")
      const dropped = summarize(events, { drop: signal })
      expect(dropped.signals[signal].signal).toBe("none")
      expect(dropped.faults).toEqual([])
    })
  }

  test("dropping typing also silences the final field read and its missing-read fault", () => {
    const lostLast = cleanRun().map((event) =>
      event.kind === "field" && event.final ? { ...event, text: "abc" } : event,
    )
    expect(summarize(lostLast, { drop: "typing" }).signals.typing.signal).toBe("none")
    const noFinal = cleanRun().filter((event) => !(event.kind === "field" && event.final))
    expect(summarize(noFinal, { drop: "typing" }).faults).toEqual([])
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
