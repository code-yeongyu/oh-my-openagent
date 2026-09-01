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
  const getEntries = manager?.getEntries
  if (typeof getEntries !== "function") return 0
  const entries = Reflect.apply(getEntries, manager, [])
  return Array.isArray(entries) ? entries.length : 0
}

export function readUi(eventCtx: unknown): StatusUi | undefined {
  if (!isRecord(eventCtx)) return undefined
  const ui = eventCtx.ui
  if (!isRecord(ui)) return undefined
  if (typeof ui.setStatus !== "function" || typeof ui.notify !== "function") return undefined
  return {
    setStatus: (key, text) => Reflect.apply(ui.setStatus as (...args: unknown[]) => unknown, ui, [key, text]),
    notify: (message, level) => Reflect.apply(ui.notify as (...args: unknown[]) => unknown, ui, [message, level]),
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
