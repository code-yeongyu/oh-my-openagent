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

type WindowFacts = { readonly role: string; readonly subrole: string; readonly layer: number }
const roleHit = (window: WindowFacts): boolean => DIALOG_ROLES.has(window.role) || DIALOG_SUBROLES.has(window.subrole)
const layerHit = (window: WindowFacts): boolean => window.layer >= MODAL_PANEL_LAYER && window.layer < MAIN_MENU_LAYER
const isDialog = (window: WindowFacts): boolean => roleHit(window) || layerHit(window)

// The recorder reports the raw AXError name of a new window's attribute reads; this table is the one judgement of
// it. An attribute that is legitimately absent is "ok"; anything that means the read did not happen is a fault, and
// an unknown name is a fault too, so a read failure can never become "not a dialog".
export const AX_READ_ERRORS: Readonly<Record<string, "ok" | "fault">> = {
  success: "ok",
  noValue: "ok",
  attributeUnsupported: "ok",
  cannotComplete: "fault",
  invalidUIElement: "fault",
  failure: "fault",
  apiDisabled: "fault",
  notImplemented: "fault",
}

// Which branch of the dialog detector fired for each dialog seen during the recording, in event order. The self-test
// uses it to prove the AX role/subrole branch on a live trial, where a layer-only hit would hide a dead AX path.
export function dialogHits(events: readonly SentinelEvent[]): ("role" | "layer")[] {
  const from = events.find((event) => event.kind === "start")?.t ?? Number.POSITIVE_INFINITY
  const until = events.find((event) => event.kind === "stop")?.t ?? Number.NEGATIVE_INFINITY
  const context = events.find((event) => event.kind === "context")
  const targets = new Set(context?.kind === "context" ? context.targetPids : [])
  const hits: ("role" | "layer")[] = []
  for (const event of [...events].sort((a, b) => a.t - b.t)) {
    if (event.kind !== "window_added" || event.t <= from || event.t > until || targets.has(event.ownerPid)) continue
    if (roleHit(event)) hits.push("role")
    else if (layerHit(event)) hits.push("layer")
  }
  return hits
}

// Only windows present in both reads are compared, so a window that opens or closes is not a raise.
export function relativeOrderChanged(before: readonly string[], after: readonly string[]): boolean {
  const common = new Set(before.filter((id) => after.includes(id)))
  const a = before.filter((id) => common.has(id))
  const b = after.filter((id) => common.has(id))
  return a.some((id, index) => b[index] !== id)
}

// `drop` is the self-test's sabotage: that detector is silenced (its verdict reads none and its own faults are
// suppressed), so the self-test can prove that a dead detector makes the run fail.
export function summarize(events: readonly SentinelEvent[], options: { readonly drop?: Signal } = {}): SentinelSummary {
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
        break
      case "stop":
        if ((event.pendingReads ?? 0) > 0)
          faults.push(`dialog: ${event.pendingReads} new-window reads were still running at stop`)
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
        if (event.index === 0) sent = ""
        else if (event.index !== sent.length)
          faults.push(`typing: typist sent index ${event.index} after ${sent.length}`)
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
        if (!inWindow(event.t) || targetPids.has(event.ownerPid)) break
        if (isDialog(event)) mark("dialog", event.t)
        else if (event.axError !== undefined && AX_READ_ERRORS[event.axError] !== "ok")
          faults.push(`dialog: new window ${event.id} of pid ${event.ownerPid} was unreadable (AX ${event.axError})`)
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

  if (options.drop !== undefined) {
    seen.delete(options.drop)
    const prefix = `${options.drop}: `
    for (let index = faults.length - 1; index >= 0; index--)
      if (faults[index]?.startsWith(prefix)) faults.splice(index, 1)
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
