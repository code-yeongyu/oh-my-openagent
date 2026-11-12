import { describe, expect, test } from "bun:test"

import {
  type Facts,
  verdictDisconnect,
  verdictElevated,
  verdictLock,
  verdictMixedDpi,
  verdictSecureDesktop,
} from "./windows-full-verdicts.ts"

const HIGH = "S-1-16-12288"
const MEDIUM = "S-1-16-8192"

const elevated = (over: Record<string, unknown> = {}): Facts => ({
  leg: "elevated",
  run: 1,
  workerLabel: MEDIUM,
  controlLabel: HIGH,
  fixtureLabel: HIGH,
  control: { postLanded: true, sendLanded: true },
  medium: { postOk: false, postError: 5, sendCount: 1, postLanded: false, sendLanded: false },
  ...over,
})

const session = (connect: number, lock: number, desktop: string | null) => ({ connect, lock, desktop })
const ACTIVE = session(0, 1, "Default")

describe("[ADP-26] q1 elevated: a real Medium-to-High boundary", () => {
  test("Medium input dropped while the High control landed confirms the boundary", () => {
    const v = verdictElevated(elevated())
    expect(v.verdict).toBe("CONFIRMS")
    expect(v.evidence).toContain("worker=S-1-16-8192")
  })

  test("Medium input that lands contradicts it: the runner enforces no UIPI", () => {
    const v = verdictElevated(
      elevated({ medium: { postOk: true, postError: 0, sendCount: 1, postLanded: true, sendLanded: false } }),
    )
    expect(v.verdict).toBe("CONTRADICTS")
    expect(v.evidence).toContain("medium post landed")
  })

  test("a worker that is not exactly Medium measures nothing", () => {
    expect(verdictElevated(elevated({ workerLabel: HIGH })).verdict).toBe("UNMEASURED")
    expect(verdictElevated(elevated({ fixtureLabel: MEDIUM })).verdict).toBe("UNMEASURED")
  })

  test("without a landed control the drop is not a finding", () => {
    const v = verdictElevated(elevated({ control: { postLanded: false, sendLanded: false } }))
    expect(v.verdict).toBe("UNMEASURED")
    expect(v.evidence).toContain("control")
  })

  test("a leg that errored is UNMEASURED, never a negative", () => {
    expect(verdictElevated(elevated({ error: "CreateProcessAsUser failed, error 1314" })).verdict).toBe("UNMEASURED")
  })
})

describe("[ADP-26] q2 lock and q3 disconnect: observed AND restored", () => {
  const lock = (over: Record<string, unknown> = {}): Facts => ({
    leg: "lock",
    run: 1,
    sessionId: 2,
    before: ACTIVE,
    timeline: [
      { ms: 10, ...ACTIVE },
      { ms: 900, ...session(0, 0, null) },
    ],
    restore: { taskResult: 0, after: ACTIVE },
    ...over,
  })

  test("a lock flag read at capture time and a restored session confirm", () => {
    expect(verdictLock(lock()).verdict).toBe("CONFIRMS")
  })

  test("a lock that was never read is UNMEASURED (a failed desktop read proves nothing)", () => {
    const v = verdictLock(
      lock({
        timeline: [
          { ms: 10, ...ACTIVE },
          { ms: 900, ...session(0, -1, null) },
        ],
      }),
    )
    expect(v.verdict).toBe("UNMEASURED")
  })

  test("a lock the SYSTEM task could not lift contradicts", () => {
    const v = verdictLock(lock({ restore: { taskResult: 0, after: session(0, 0, null) } }))
    expect(v.verdict).toBe("CONTRADICTS")
    expect(v.evidence).toContain("not restored")
  })

  const disc = (over: Record<string, unknown> = {}): Facts => ({
    leg: "disconnect",
    run: 1,
    sessionId: 2,
    before: ACTIVE,
    holdTargetMs: 8000,
    timeline: [
      { ms: 10, ...ACTIVE },
      { ms: 200, ...session(4, 1, null) },
      { ms: 8100, ...session(4, 1, null) },
    ],
    restore: { taskResult: 0, after: ACTIVE },
    ...over,
  })

  test("a disconnect held for the whole window and restored confirms", () => {
    const v = verdictDisconnect(disc())
    expect(v.verdict).toBe("CONFIRMS")
    expect(v.evidence).toContain("held 7900 ms")
  })

  test("a session that reconnects on its own before the window contradicts", () => {
    const v = verdictDisconnect(
      disc({
        timeline: [
          { ms: 10, ...ACTIVE },
          { ms: 200, ...session(4, 1, null) },
          { ms: 1900, ...ACTIVE },
        ],
      }),
    )
    expect(v.verdict).toBe("CONTRADICTS")
    expect(v.evidence).toContain("reconnected by itself")
  })

  test("a disconnect never read is UNMEASURED", () => {
    expect(verdictDisconnect(disc({ timeline: [{ ms: 10, ...ACTIVE }] })).verdict).toBe("UNMEASURED")
  })
})

describe("[ADP-26] q4 mixed DPI: two monitors, the second at 144 effective DPI", () => {
  const dpi = (over: Record<string, unknown> = {}): Facts => ({
    leg: "mixed-dpi",
    run: 1,
    awareness: 2,
    install: { downloadOk: true, certOk: true, deviceOk: true, driverOk: true, error: "" },
    monitors: [
      { primary: true, dpi: 96 },
      { primary: false, dpi: 144 },
    ],
    ...over,
  })

  test("a secondary monitor reading 144 from a per-monitor-aware process confirms", () => {
    expect(verdictMixedDpi(dpi()).verdict).toBe("CONFIRMS")
  })

  test("a secondary stuck at 96 contradicts, with the read named", () => {
    const v = verdictMixedDpi(
      dpi({
        monitors: [
          { primary: true, dpi: 96 },
          { primary: false, dpi: 96 },
        ],
      }),
    )
    expect(v.verdict).toBe("CONTRADICTS")
    expect(v.evidence).toContain("dpi=96")
  })

  test("a DPI read from a process that is not per-monitor aware is UNMEASURED", () => {
    expect(verdictMixedDpi(dpi({ awareness: 1 })).verdict).toBe("UNMEASURED")
  })

  test("an install that failed is UNMEASURED; a clean install with one monitor contradicts", () => {
    const failed = dpi({
      install: { downloadOk: true, certOk: true, deviceOk: false, driverOk: false, error: "e=0xE0000203" },
    })
    expect(verdictMixedDpi(failed).verdict).toBe("UNMEASURED")
    expect(verdictMixedDpi(dpi({ monitors: [{ primary: true, dpi: 96 }] })).verdict).toBe("CONTRADICTS")
  })

  test("no primary in the enumeration means the list itself is not trusted", () => {
    expect(verdictMixedDpi(dpi({ monitors: [{ primary: false, dpi: 144 }] })).verdict).toBe("UNMEASURED")
  })
})

describe("[ADP-26] q5 secure desktop for the refusal leg", () => {
  const sd = (over: Record<string, unknown> = {}): Facts => ({
    leg: "secure-desktop",
    run: 1,
    workerLabel: MEDIUM,
    enableLua: 1,
    promptOnSecureDesktop: 1,
    consentPromptBehaviorAdmin: 5,
    consentSeen: true,
    controlSeen: true,
    desktops: ["Default", "Winlogon"],
    ...over,
  })

  test("consent.exe present and the input desktop read as Winlogon confirms", () => {
    expect(verdictSecureDesktop(sd()).verdict).toBe("CONFIRMS")
  })

  test("no prompt with EnableLUA=0 read from the registry contradicts and names the values", () => {
    const v = verdictSecureDesktop(
      sd({ enableLua: 0, promptOnSecureDesktop: 0, consentSeen: false, desktops: ["Default"] }),
    )
    expect(v.verdict).toBe("CONTRADICTS")
    expect(v.evidence).toContain("EnableLUA=0")
  })

  test("no prompt with UAC on but ConsentPromptBehaviorAdmin=0 (elevate without prompting) contradicts", () => {
    const v = verdictSecureDesktop(sd({ consentPromptBehaviorAdmin: 0, consentSeen: false, desktops: ["Default"] }))
    expect(v.verdict).toBe("CONTRADICTS")
    expect(v.evidence).toContain("ConsentPromptBehaviorAdmin=0")
  })

  test("no prompt while the process list missed its own control is UNMEASURED", () => {
    const v = verdictSecureDesktop(sd({ enableLua: 0, consentSeen: false, controlSeen: false, desktops: ["Default"] }))
    expect(v.verdict).toBe("UNMEASURED")
  })

  test("no prompt with UAC on is not an absence finding by itself", () => {
    expect(verdictSecureDesktop(sd({ consentSeen: false, desktops: ["Default"] })).verdict).toBe("UNMEASURED")
  })
})
