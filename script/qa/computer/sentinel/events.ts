// The wire format between the native recorder/typist and the driver: one JSON object per line, `t` in milliseconds
// on the host's monotonic uptime clock shared by every helper process.

export const SIGNALS = [
  "key_focus",
  "window_raised",
  "typing",
  "pointer",
  "clipboard",
  "space",
  "dialog",
  "activation",
] as const

export type Signal = (typeof SIGNALS)[number]

type Via = "notification" | "sample"

export type SentinelEvent = { readonly t: number } & (
  | { readonly kind: "context"; readonly userPid: number; readonly targetPids: readonly number[] }
  | { readonly kind: "armed"; readonly signal: Signal; readonly via: string }
  | { readonly kind: "fault"; readonly signal: Signal; readonly detail: string }
  | { readonly kind: "tick" | "start" }
  | { readonly kind: "stop"; readonly pendingReads?: number }
  | { readonly kind: "focus" | "space"; readonly via: Via; readonly value: string }
  | { readonly kind: "order"; readonly windows: readonly string[] }
  | { readonly kind: "typed"; readonly index: number; readonly char: string }
  | { readonly kind: "field"; readonly text: string; readonly final: boolean }
  | { readonly kind: "pointer"; readonly via: "tap" | "sample"; readonly x: number; readonly y: number }
  | { readonly kind: "clipboard"; readonly changeCount: number }
  | { readonly kind: "activation"; readonly via: Via; readonly pid: number }
  | {
      readonly kind: "window_added"
      // "ax": a window/sheet-created notification and the recorder's own attribute reads of it, which must carry
      // their facts (which notification, how many read attempts, the last AXError). "sample": the window list.
      readonly source: "ax" | "sample"
      readonly id: string
      readonly ownerPid: number
      readonly role: string
      readonly subrole: string
      readonly layer: number
      readonly notification?: "window" | "sheet"
      readonly axError?: string
      readonly axReads?: number
    }
  | {
      // A window observer that was not registered from `since` (the app's launch or the first attempt) until `t`
      // (observer_late) or ever (observer_failed): a sheet in that gap is invisible to every branch.
      readonly kind: "observer_failed"
      readonly pid: number
      readonly axError: string
      readonly attempts: number
      readonly regular: boolean
      readonly since: number
    }
  | {
      readonly kind: "observer_late"
      readonly pid: number
      readonly attempts: number
      readonly regular: boolean
      readonly since: number
    }
  | { readonly kind: "leak"; readonly what: "key" | "mouse" }
)

type Check = (value: unknown) => boolean

const num: Check = (value) => typeof value === "number" && Number.isFinite(value)
const str: Check = (value) => typeof value === "string"
const bool: Check = (value) => typeof value === "boolean"
const oneOf =
  (...allowed: readonly string[]): Check =>
  (value) =>
    typeof value === "string" && allowed.includes(value)
const listOf =
  (item: Check): Check =>
  (value) =>
    Array.isArray(value) && value.every(item)
const via = oneOf("notification", "sample")
const optional =
  (check: Check): Check =>
  (value) =>
    value === undefined || check(value)

const SHAPES: Readonly<Record<SentinelEvent["kind"], Readonly<Record<string, Check>>>> = {
  context: { userPid: num, targetPids: listOf(num) },
  armed: { signal: oneOf(...SIGNALS), via: str },
  fault: { signal: oneOf(...SIGNALS), detail: str },
  tick: {},
  start: {},
  stop: { pendingReads: optional(num) },
  focus: { via, value: str },
  space: { via, value: str },
  order: { windows: listOf(str) },
  typed: { index: num, char: str },
  field: { text: str, final: bool },
  pointer: { via: oneOf("tap", "sample"), x: num, y: num },
  clipboard: { changeCount: num },
  activation: { via, pid: num },
  window_added: {
    source: oneOf("ax", "sample"),
    id: str,
    ownerPid: num,
    role: str,
    subrole: str,
    layer: num,
    notification: optional(oneOf("window", "sheet")),
    axError: optional(str),
    axReads: optional(num),
  },
  observer_failed: { pid: num, axError: str, attempts: num, regular: bool, since: num },
  observer_late: { pid: num, attempts: num, regular: bool, since: num },
  leak: { what: oneOf("key", "mouse") },
}

const isKind = (kind: unknown): kind is SentinelEvent["kind"] => typeof kind === "string" && Object.hasOwn(SHAPES, kind)

function isEvent(value: unknown): value is SentinelEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record: Readonly<Record<string, unknown>> = Object.fromEntries(Object.entries(value))
  if (!num(record.t) || !isKind(record.kind)) return false
  return Object.entries(SHAPES[record.kind]).every(([field, check]) => check(record[field]))
}

export function parseEvents(jsonl: string): { readonly events: SentinelEvent[]; readonly faults: string[] } {
  const events: SentinelEvent[] = []
  const faults: string[] = []
  jsonl.split("\n").forEach((line, index) => {
    if (line.trim() === "") return
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      faults.push(`recording: line ${index + 1} is not JSON`)
      return
    }
    if (isEvent(value)) events.push(value)
    else faults.push(`recording: line ${index + 1} is not a sentinel event: ${line.slice(0, 120)}`)
  })
  return { events, faults }
}
