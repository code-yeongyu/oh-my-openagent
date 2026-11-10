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

/**
 * Last status text published per host ui and key (#13046). Footer refreshes land in whatever order their
 * async work settles, so several can compute the same line; re-publishing an unchanged line changes nothing
 * on screen but makes the number of status updates depend on timing. Keyed by the host ui object, so every
 * handle `readUi` returns for one session shares it.
 */
const publishedStatus = new WeakMap<object, Map<string, string | undefined>>()

export function readUi(eventCtx: unknown): StatusUi | undefined {
  if (!isRecord(eventCtx)) return undefined
  const ui = eventCtx.ui
  if (!isRecord(ui)) return undefined
  if (typeof ui.setStatus !== "function" || typeof ui.notify !== "function") return undefined
  return {
    setStatus: (key, text) => {
      let published = publishedStatus.get(ui)
      if (published === undefined) {
        published = new Map()
        publishedStatus.set(ui, published)
      }
      if (text !== undefined && published.get(key) === text) return
      published.set(key, text)
      Reflect.apply(ui.setStatus as (...args: unknown[]) => unknown, ui, [key, text])
    },
    notify: (message, level) => Reflect.apply(ui.notify as (...args: unknown[]) => unknown, ui, [message, level]),
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
