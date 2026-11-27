import { type SentinelEvent, SIGNALS, type Signal, summarize } from "./summary.ts"

// The shared reducer fixture of the summary tests.

export const USER_PID = 100
export const TARGET_PID = 200
const START = 1_000
const STOP = 3_000

// A clean recording: every detector armed, a baseline sample for every sampled signal, a 20 Hz sampler that never
// stalls, a typist whose field always holds exactly what it sent, and a final field read after the last keystroke.
export function cleanRun(extra: readonly SentinelEvent[] = []): SentinelEvent[] {
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
  events.push({ t: START, kind: "start" }, { t: STOP, kind: "stop", pendingReads: 0, pendingRegistrations: 0 })
  events.push({ t: 4_000, kind: "field", text: typed, final: true })
  return [...events, ...extra].sort((a, b) => a.t - b.t)
}

export const happened = (events: readonly SentinelEvent[]): Signal[] =>
  SIGNALS.filter((signal) => summarize(events).signals[signal].signal === "happened")
