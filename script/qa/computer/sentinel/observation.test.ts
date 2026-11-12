import { describe, expect, test } from "bun:test"

import { type DesktopSnapshot, observe } from "./observation.ts"
import type { SentinelEvent } from "./summary.ts"
import { SIGNALS } from "./summary.ts"

const snapshot: DesktopSnapshot = {
  frontmostPid: 100,
  focused: "typist/field",
  order: ["typist#1", "target#2"],
  pointer: { x: 400, y: 300 },
}

function recording(extra: readonly SentinelEvent[] = []): SentinelEvent[] {
  const events: SentinelEvent[] = [{ t: 0, kind: "context", userPid: 100, targetPids: [200] }]
  for (const signal of SIGNALS) events.push({ t: 1, kind: "armed", signal, via: "test" })
  events.push(
    { t: 10, kind: "focus", via: "sample", value: "typist/field" },
    { t: 10, kind: "order", windows: ["typist#1", "target#2"] },
    { t: 10, kind: "pointer", via: "sample", x: 400, y: 300 },
    { t: 10, kind: "clipboard", changeCount: 1 },
    { t: 10, kind: "space", via: "sample", value: "s1" },
    { t: 10, kind: "activation", via: "sample", pid: 100 },
    { t: 500, kind: "typed", index: 0, char: "a" },
    { t: 540, kind: "field", text: "a", final: false },
  )
  for (let t = 0; t <= 2_000; t += 50) events.push({ t, kind: "tick" })
  events.push(
    { t: 100, kind: "start" },
    { t: 1_500, kind: "stop", pendingReads: 0 },
    { t: 1_600, kind: "field", text: "a", final: true },
  )
  return [...events, ...extra].sort((a, b) => a.t - b.t)
}

describe("desktop observer", () => {
  test("[ADP-2] an undisturbed cell keeps its own status and reads no change", () => {
    const cell = observe("cell-fails-its-oracle", snapshot, snapshot, recording())
    expect(cell.status).toBe("cell-fails-its-oracle")
    expect(cell.observed).toMatchObject({
      foregroundChanged: false,
      stackingChanged: false,
      pointerMoved: false,
      leakedInput: [],
      verdict: "clean",
    })
  })

  test("[ADP-2] a raise and a focus steal restored before the after-snapshot are still in the journal", () => {
    const cell = observe(
      true,
      snapshot,
      snapshot,
      recording([
        { t: 600, kind: "order", windows: ["target#2", "typist#1"] },
        { t: 650, kind: "order", windows: ["typist#1", "target#2"] },
        { t: 700, kind: "focus", via: "notification", value: "target/button" },
        { t: 750, kind: "focus", via: "notification", value: "typist/field" },
      ]),
    )
    expect(cell.status).toBe(true)
    expect(cell.observed.stackingChanged).toBe(true)
    expect(cell.observed.focusJournal.map((entry) => entry.value)).toEqual(["target/button", "typist/field"])
    expect(cell.observed.verdict).toBe("disturbed")
  })

  test("[ADP-2] the snapshots alone catch a foreground or stacking change the journal did not see", () => {
    const after = { ...snapshot, frontmostPid: 200, order: ["target#2", "typist#1"] }
    const cell = observe(true, snapshot, after, recording())
    expect(cell.observed.foregroundChanged).toBe(true)
    expect(cell.observed.stackingChanged).toBe(true)
    expect(cell.observed.verdict).toBe("disturbed")
  })

  test("[ADP-2] input that leaked into the occluding sentinel window is journalled", () => {
    const cell = observe(true, snapshot, snapshot, recording([{ t: 800, kind: "leak", what: "mouse" }]))
    expect(cell.observed.leakedInput).toEqual([{ t: 800, what: "mouse" }])
    expect(cell.observed.verdict).toBe("disturbed")
  })

  test("[ADP-4] negative control: a 50 px warp-and-return leaves equal snapshots but reads pointer moved", () => {
    const cell = observe(
      true,
      snapshot,
      snapshot,
      recording([
        { t: 900, kind: "pointer", via: "sample", x: 450, y: 300 },
        { t: 1_050, kind: "pointer", via: "sample", x: 400, y: 300 },
      ]),
    )
    expect(cell.observed.pointerMoved).toBe(true)
    expect(cell.observed.verdict).toBe("disturbed")
  })

  test("a recording with a fault is invalid whatever the snapshots say", () => {
    const cell = observe(
      true,
      snapshot,
      snapshot,
      recording([{ t: 800, kind: "fault", signal: "dialog", detail: "observer lost" }]),
    )
    expect(cell.observed.verdict).toBe("invalid")
  })
})
