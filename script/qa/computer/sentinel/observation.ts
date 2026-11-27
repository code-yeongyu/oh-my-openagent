import {
  relativeOrderChanged,
  type SentinelEvent,
  type SentinelSummary,
  summarize,
  type Verdict,
  verdict,
} from "./summary.ts"

// The desktop observer a conformance cell attaches: a before and after snapshot of the person's desktop plus the
// recorder's journal in between. The cell's own test status is carried through untouched and never read here, so a
// cell can pass its oracle and still be reported as disturbing, or fail it without being blamed for a disturbance.

export type DesktopSnapshot = {
  readonly frontmostPid: number
  readonly focused: string
  readonly order: readonly string[]
  readonly pointer: { readonly x: number; readonly y: number }
}

type JournalEntry = { readonly t: number; readonly what: string; readonly value: string }

type Observed = {
  readonly foregroundChanged: boolean
  readonly stackingChanged: boolean
  readonly pointerMoved: boolean
  readonly focusJournal: readonly JournalEntry[]
  readonly leakedInput: readonly { readonly t: number; readonly what: "key" | "mouse" }[]
  readonly signals: SentinelSummary
  readonly verdict: Verdict
}

export type CellObservation<Status> = { readonly status: Status; readonly observed: Observed }

const inside = (event: SentinelEvent, from: number, until: number): boolean => event.t > from && event.t <= until

export function observe<Status>(
  status: Status,
  before: DesktopSnapshot,
  after: DesktopSnapshot,
  events: readonly SentinelEvent[],
): CellObservation<Status> {
  const signals = summarize(events)
  const from = events.find((event) => event.kind === "start")?.t ?? Number.POSITIVE_INFINITY
  const until = events.find((event) => event.kind === "stop")?.t ?? Number.NEGATIVE_INFINITY
  const during = events.filter((event) => inside(event, from, until))

  const focusJournal: JournalEntry[] = []
  const leakedInput: { t: number; what: "key" | "mouse" }[] = []
  for (const event of during) {
    if (event.kind === "focus" && event.via === "notification")
      focusJournal.push({ t: event.t, what: "focus", value: event.value })
    if (event.kind === "activation" && event.via === "notification")
      focusJournal.push({ t: event.t, what: "activation", value: String(event.pid) })
    if (event.kind === "leak") leakedInput.push({ t: event.t, what: event.what })
  }

  const foregroundChanged =
    before.frontmostPid !== after.frontmostPid ||
    before.focused !== after.focused ||
    signals.signals.activation.signal === "happened" ||
    signals.signals.key_focus.signal === "happened"
  const stackingChanged =
    relativeOrderChanged(before.order, after.order) || signals.signals.window_raised.signal === "happened"
  const pointerMoved =
    before.pointer.x !== after.pointer.x ||
    before.pointer.y !== after.pointer.y ||
    signals.signals.pointer.signal === "happened"

  const recorded = verdict(signals)
  const snapshotsMoved = foregroundChanged || stackingChanged || pointerMoved
  const observedVerdict: Verdict =
    recorded === "invalid" ? "invalid" : snapshotsMoved || recorded === "disturbed" ? "disturbed" : "clean"
  return {
    status,
    observed: {
      foregroundChanged,
      stackingChanged,
      pointerMoved,
      focusJournal,
      leakedInput,
      signals,
      verdict: observedVerdict,
    },
  }
}
