// The disturbance sentinel's pure reducer: the recorder's event stream in, one judgement per signal out. The eight
// signal ids are the shared columns of the sentinel, the conformance catalog and the action report. The criterion is
// "happened at any moment between start and stop", never "restored by stop". A read that failed, a detector that
// never armed or a sampler that stalled is a fault that makes the run invalid; it is never read as "none".

import { type SentinelEvent, SIGNALS, type Signal } from "./events.ts"

export { parseEvents, type SentinelEvent, SIGNALS, type Signal } from "./events.ts"

export type SignalSummary = {
  readonly signal: "none" | "happened"
  readonly firstAt: number | null
  readonly count: number
}

export type SentinelSummary = {
  readonly signals: Readonly<Record<Signal, SignalSummary>>
  readonly faults: readonly string[]
}

export type Verdict = "clean" | "disturbed" | "invalid"

// 20 Hz is a 50 ms period; five missed periods in a row means the sampler stalled.
const MAX_TICK_GAP_MS = 250
// CGWindowLevel range of modal panels up to (not including) the main menu: alerts and system dialogs live here.
const MODAL_PANEL_LAYER = 8
const MAIN_MENU_LAYER = 24
const DIALOG_ROLES = new Set(["AXSheet"])
const DIALOG_SUBROLES = new Set(["AXDialog", "AXSystemDialog"])
const SAMPLED: readonly Signal[] = ["key_focus", "window_raised", "pointer", "clipboard", "space", "activation"]

const isDialog = (window: { readonly role: string; readonly subrole: string; readonly layer: number }): boolean =>
  DIALOG_ROLES.has(window.role) ||
  DIALOG_SUBROLES.has(window.subrole) ||
  (window.layer >= MODAL_PANEL_LAYER && window.layer < MAIN_MENU_LAYER)

// Only windows present in both reads are compared, so a window that opens or closes is not a raise.
export function relativeOrderChanged(before: readonly string[], after: readonly string[]): boolean {
  const common = new Set(before.filter((id) => after.includes(id)))
  const a = before.filter((id) => common.has(id))
  const b = after.filter((id) => common.has(id))
  return a.some((id, index) => b[index] !== id)
}

export function summarize(events: readonly SentinelEvent[]): SentinelSummary {
  const ordered = [...events].sort((a, b) => a.t - b.t)
  const start = ordered.find((event) => event.kind === "start")?.t
  const stop = ordered.find((event) => event.kind === "stop")?.t
  const faults: string[] = []
  if (start === undefined) faults.push("recording: no start marker")
  if (stop === undefined) faults.push("recording: no stop marker")
  const from = start ?? Number.POSITIVE_INFINITY
  const until = stop ?? Number.NEGATIVE_INFINITY
  const inWindow = (t: number): boolean => t > from && t <= until

  const seen = new Map<Signal, { firstAt: number; count: number }>()
  const mark = (signal: Signal, t: number): void => {
    const prior = seen.get(signal)
    seen.set(signal, { firstAt: prior?.firstAt ?? t, count: (prior?.count ?? 0) + 1 })
  }
  const armed = new Set<Signal>()
  const baseline = new Set<Signal>()
  const last = new Map<Signal, string>()
  const observe = (signal: Signal, t: number, value: string, alwaysCounts: boolean): void => {
    if (t <= from) baseline.add(signal)
    else if (inWindow(t) && (alwaysCounts || (last.has(signal) && last.get(signal) !== value))) mark(signal, t)
    last.set(signal, value)
  }

  let targetPids = new Set<number>()
  let order: readonly string[] | undefined
  let sent = ""
  let lastTypedAt = Number.NEGATIVE_INFINITY
  let finalRead = false
  const ticks: number[] = []

  for (const event of ordered) {
    switch (event.kind) {
      case "context":
        targetPids = new Set(event.targetPids)
        break
      case "armed":
        if (event.t <= from) armed.add(event.signal)
        break
      case "fault":
        if (event.t <= until) faults.push(`${event.signal}: ${event.detail}`)
        break
      case "tick":
        if (event.t >= from && event.t <= until) ticks.push(event.t)
        break
      case "start":
      case "stop":
        break
      case "focus":
        observe("key_focus", event.t, event.value, event.via === "notification")
        break
      case "space":
        observe("space", event.t, event.value, event.via === "notification")
        break
      case "activation":
        observe("activation", event.t, String(event.pid), event.via === "notification")
        break
      case "pointer":
        observe("pointer", event.t, `${event.x},${event.y}`, event.via === "tap")
        break
      case "clipboard":
        observe("clipboard", event.t, String(event.changeCount), false)
        break
      case "order":
        if (event.t <= from) baseline.add("window_raised")
        else if (inWindow(event.t) && order !== undefined && relativeOrderChanged(order, event.windows))
          mark("window_raised", event.t)
        order = event.windows
        break
      case "typed":
        if (event.index !== sent.length) faults.push(`typing: typist sent index ${event.index} after ${sent.length}`)
        sent += event.char
        lastTypedAt = event.t
        break
      case "field":
        if (event.final) {
          if (event.t < lastTypedAt) break
          finalRead = true
          if (event.text !== sent) mark("typing", event.t)
        } else if (inWindow(event.t) && !sent.startsWith(event.text)) mark("typing", event.t)
        break
      case "window_added":
        if (inWindow(event.t) && !targetPids.has(event.ownerPid) && isDialog(event)) mark("dialog", event.t)
        break
      case "leak":
        if (inWindow(event.t)) mark(event.what === "key" ? "typing" : "pointer", event.t)
        break
    }
  }

  for (const signal of SIGNALS) if (!armed.has(signal)) faults.push(`${signal}: detector never armed`)
  for (const signal of SAMPLED) if (!baseline.has(signal)) faults.push(`${signal}: no baseline read before start`)
  if (!finalRead) faults.push("typing: no final field read after the last keystroke")
  if (start !== undefined && stop !== undefined) {
    const stamps = [start, ...ticks, stop]
    const gap = Math.max(...stamps.slice(1).map((t, index) => t - (stamps[index] ?? t)))
    if (gap > MAX_TICK_GAP_MS) faults.push(`sampler: no tick for ${gap} ms (20 Hz expected)`)
  }

  const signals = Object.fromEntries(
    SIGNALS.map((signal) => {
      const hit = seen.get(signal)
      const summary: SignalSummary =
        hit === undefined
          ? { signal: "none", firstAt: null, count: 0 }
          : { signal: "happened", firstAt: hit.firstAt, count: hit.count }
      return [signal, summary]
    }),
  )
  return { signals: signalRecord(signals), faults }
}

function signalRecord(entries: Readonly<Record<string, SignalSummary>>): Record<Signal, SignalSummary> {
  const none: SignalSummary = { signal: "none", firstAt: null, count: 0 }
  return {
    key_focus: entries.key_focus ?? none,
    window_raised: entries.window_raised ?? none,
    typing: entries.typing ?? none,
    pointer: entries.pointer ?? none,
    clipboard: entries.clipboard ?? none,
    space: entries.space ?? none,
    dialog: entries.dialog ?? none,
    activation: entries.activation ?? none,
  }
}

export function verdict(summary: SentinelSummary): Verdict {
  if (summary.faults.length > 0) return "invalid"
  return SIGNALS.some((signal) => summary.signals[signal].signal === "happened") ? "disturbed" : "clean"
}

export const formatSignals = (summary: SentinelSummary): string =>
  SIGNALS.map((signal) => `${signal}=${summary.signals[signal].signal}`).join(" ")
