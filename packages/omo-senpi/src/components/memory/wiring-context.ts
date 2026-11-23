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
  /** The refresh request that produced the line; an unsequenced write takes the latest request issued. */
  readonly request: number
}

interface HostStatus {
  requests: number
  readonly lines: Map<string, PublishedLine>
}

/**
 * Status lines published per host ui and key (#13046), keyed by the host ui object so every handle `readUi` returns
 * for one session shares them. Footer refreshes read memory state at different moments and land in whatever order
 * their async work settles. Two rules keep the published sequence a function of the state the refreshes read:
 * an unchanged line is never re-published, and a line read by an older refresh request never replaces one a newer
 * request already published. Clears and unsequenced writes always pass and supersede every request issued so far.
 */
const hostStatus = new WeakMap<object, HostStatus>()
const STATUS_HOST = Symbol("omo.memory.status-host")

function statusOf(host: object): HostStatus {
  let state = hostStatus.get(host)
  if (state === undefined) {
    state = { requests: 0, lines: new Map() }
    hostStatus.set(host, state)
  }
  return state
}

function publishStatus(
  host: object,
  deliver: (key: string, text: string | undefined) => void,
  key: string,
  text: string | undefined,
  request: number | undefined,
): void {
  const state = statusOf(host)
  const last = state.lines.get(key)
  if (text !== undefined && request !== undefined && last !== undefined && request < last.request) return
  // A clear supersedes every refresh already requested; an unsequenced line (the reflecting spinner) neither
  // supersedes nor is superseded, so the footer restore that follows the spinner still lands.
  const stamp = request ?? (text === undefined ? state.requests : (last?.request ?? 0))
  if (text !== undefined && last?.text === text) {
    state.lines.set(key, { text, request: Math.max(last.request, stamp) })
    return
  }
  deliver(key, text)
  // Recorded only once the host took it: a line the host never showed must not suppress the retry.
  state.lines.set(key, { text, request: stamp })
}

export function readUi(eventCtx: unknown): StatusUi | undefined {
  if (!isRecord(eventCtx)) return undefined
  const ui = eventCtx.ui
  if (!isRecord(ui)) return undefined
  if (typeof ui.setStatus !== "function" || typeof ui.notify !== "function") return undefined
  const deliver = (key: string, text: string | undefined): void => {
    Reflect.apply(ui.setStatus as (...args: unknown[]) => unknown, ui, [key, text])
  }
  return {
    setStatus: (key, text) => publishStatus(ui, deliver, key, text, undefined),
    notify: (message, level) => Reflect.apply(ui.notify as (...args: unknown[]) => unknown, ui, [message, level]),
    [STATUS_HOST]: { ui, deliver },
  } as StatusUi
}

/**
 * A status handle that publishes only while `allow()` holds, and still belongs to its host's sequence: a refresh made
 * through it orders against every other refresh of the same host ui (#14825 review M1). A plain `{ setStatus }` wrapper
 * would get a sequence of its own and publish through the host unsequenced, so its older reads could overwrite newer lines.
 */
export function guardedStatus(ui: StatusSetter, allow: () => boolean): StatusSetter {
  const bound = (ui as { [STATUS_HOST]?: { ui: object; deliver: (key: string, text: string | undefined) => void } })[
    STATUS_HOST
  ]
  const deliver = (key: string, text: string | undefined): void => {
    if (!allow()) return
    if (bound === undefined) ui.setStatus(key, text)
    else bound.deliver(key, text)
  }
  const host = bound?.ui ?? ui
  return {
    setStatus: (key, text) => {
      if (allow()) publishStatus(host, deliver, key, text, undefined)
    },
    [STATUS_HOST]: { ui: host, deliver },
  } as StatusSetter
}

/**
 * A status handle for ONE footer refresh. Call it when the refresh starts, before it reads any memory state: the
 * request it takes orders the refresh against every other refresh of the same host ui, so a refresh whose read is
 * older than a line already on screen drops its result instead of overwriting it.
 */
export function sequencedStatus(ui: StatusSetter): StatusSetter {
  const bound = (ui as { [STATUS_HOST]?: { ui: object; deliver: (key: string, text: string | undefined) => void } })[
    STATUS_HOST
  ]
  const host = bound?.ui ?? ui
  const deliver = bound?.deliver ?? ((key: string, text: string | undefined) => ui.setStatus(key, text))
  const state = statusOf(host)
  state.requests += 1
  const request = state.requests
  return { setStatus: (key, text) => publishStatus(host, deliver, key, text, request) }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
