import type { StatusUi } from "./wiring-types"

export function sessionIdFrom(eventCtx: unknown): string | undefined {
  if (!isRecord(eventCtx)) return undefined
  const manager = isRecord(eventCtx.sessionManager) ? eventCtx.sessionManager : undefined
  const getter = manager?.getSessionId
  if (typeof getter !== "function") return undefined
  const id = Reflect.apply(getter, manager, [])
  return typeof id === "string" && id.length > 0 ? id : undefined
}

export function branchEntryCount(eventCtx: unknown): number {
  if (!isRecord(eventCtx)) return 0
  const manager = isRecord(eventCtx.sessionManager) ? eventCtx.sessionManager : undefined
  const getEntryCount = manager?.getEntryCount
  if (typeof getEntryCount === "function") {
    const count = Reflect.apply(getEntryCount, manager, [])
    if (typeof count === "number" && Number.isFinite(count)) return count
  }
  const getEntries = manager?.getEntries
  if (typeof getEntries !== "function") return 0
  const entries = Reflect.apply(getEntries, manager, [])
  return Array.isArray(entries) ? entries.length : 0
}

export interface StatusSetter {
  setStatus(key: string, text: string | undefined): void
}

interface PublishedLine {
  readonly text: string | undefined
  /** The refresh request whose read produced the line; 0 for a line no sequenced refresh produced. */
  readonly request: number
}

interface HostStatus {
  /** Refresh requests issued so far for this host ui; the next request takes `requests + 1`. */
  requests: number
  /** Per key, the request count when the key was last cleared: a refresh requested at or before it is stale. */
  readonly clearedAt: Map<string, number>
  readonly lines: Map<string, PublishedLine>
}

type Deliver = (key: string, text: string | undefined) => void

interface StatusBinding {
  readonly host: object
  readonly deliver: Deliver
  readonly allow: () => boolean
}

/**
 * Status lines published per host ui and key (#13046, #14825), keyed by the host ui object so every handle for one
 * session shares them. Invariant: the host shows the result of the newest ALLOWED request; a refused or stale publish
 * changes no state. Concretely:
 * - a publish whose guard refuses it returns before reading or writing any state;
 * - a clear delivers, and every refresh requested before it (`request <= clearedAt`) is stale from then on;
 * - a sequenced line from a request older than the line on screen, or older than the last clear, is dropped;
 * - an unchanged line is not re-delivered (only its request stamp moves forward);
 * - an unsequenced line (the reflecting spinner) is delivered but never moves the request stamp or the clear boundary,
 *   so the restore refresh that follows it still lands and a pre-clear refresh still stays dropped.
 */
const hostStatus = new WeakMap<object, HostStatus>()
const STATUS_HOST = Symbol("omo.memory.status-host")

function statusOf(host: object): HostStatus {
  let state = hostStatus.get(host)
  if (state === undefined) {
    state = { requests: 0, clearedAt: new Map(), lines: new Map() }
    hostStatus.set(host, state)
  }
  return state
}

function publishStatus(
  binding: StatusBinding,
  key: string,
  text: string | undefined,
  request: number | undefined,
): void {
  if (!binding.allow()) return
  const state = statusOf(binding.host)
  const last = state.lines.get(key)
  if (text === undefined) {
    binding.deliver(key, undefined)
    state.clearedAt.set(key, state.requests)
    state.lines.set(key, { text: undefined, request: last?.request ?? 0 })
    return
  }
  if (request !== undefined) {
    if (request <= (state.clearedAt.get(key) ?? 0)) return
    if (last !== undefined && request < last.request) return
  }
  const stamp = request ?? last?.request ?? 0
  if (last?.text === text) {
    state.lines.set(key, { text, request: Math.max(last.request, stamp) })
    return
  }
  binding.deliver(key, text)
  // Recorded only once the host took it: a line the host never showed must not suppress the retry.
  state.lines.set(key, { text, request: Math.max(last?.request ?? 0, stamp) })
}

function bindingOf(ui: StatusSetter): StatusBinding | undefined {
  return (ui as { [STATUS_HOST]?: StatusBinding })[STATUS_HOST]
}

export function readUi(eventCtx: unknown): StatusUi | undefined {
  if (!isRecord(eventCtx)) return undefined
  const ui = eventCtx.ui
  if (!isRecord(ui)) return undefined
  if (typeof ui.setStatus !== "function" || typeof ui.notify !== "function") return undefined
  const binding: StatusBinding = {
    host: ui,
    deliver: (key, text) => {
      Reflect.apply(ui.setStatus as (...args: unknown[]) => unknown, ui, [key, text])
    },
    allow: () => true,
  }
  return {
    setStatus: (key, text) => publishStatus(binding, key, text, undefined),
    notify: (message, level) => Reflect.apply(ui.notify as (...args: unknown[]) => unknown, ui, [message, level]),
    [STATUS_HOST]: binding,
  } as StatusUi
}

/**
 * A status handle that publishes only while `allow()` holds and still belongs to its host's sequence (#14825 review M1):
 * a refresh made through it orders against every other refresh of the same host ui, and a publish it refuses leaves the
 * host's state untouched, so a later allowed refresh with the same text still reaches the host.
 */
export function guardedStatus(ui: StatusSetter, allow: () => boolean): StatusSetter {
  const inner = bindingOf(ui)
  const binding: StatusBinding = {
    host: inner?.host ?? ui,
    deliver: inner?.deliver ?? ((key, text) => ui.setStatus(key, text)),
    allow: () => allow() && (inner?.allow() ?? true),
  }
  return {
    setStatus: (key, text) => publishStatus(binding, key, text, undefined),
    [STATUS_HOST]: binding,
  } as StatusSetter
}

/**
 * A status handle for ONE footer refresh. Call it when the refresh starts, before it reads any memory state: the
 * request it takes orders the refresh against every other refresh of the same host ui, so a refresh whose read is
 * older than a line already on screen, or than the last clear, drops its result instead of overwriting it.
 */
export function sequencedStatus(ui: StatusSetter): StatusSetter {
  const binding = bindingOf(ui) ?? { host: ui, deliver: (key, text) => ui.setStatus(key, text), allow: () => true }
  const state = statusOf(binding.host)
  state.requests += 1
  const request = state.requests
  return { setStatus: (key, text) => publishStatus(binding, key, text, request) }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
