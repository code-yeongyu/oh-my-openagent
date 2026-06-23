import { RawInteractionForbiddenError } from "../types"

const RAW_METHODS = ["click", "dblclick", "fill", "type", "press", "check", "uncheck", "selectOption"] as const

export type AuditMode = "enforce" | "warn" | "off"

let currentMode: AuditMode = "enforce"

export function setAuditMode(mode: AuditMode): void {
  currentMode = mode
}

export function getAuditMode(): AuditMode {
  return currentMode
}

export function auditRawInteraction(method: string): void {
  if (currentMode === "off") return

  if (RAW_METHODS.includes(method as typeof RAW_METHODS[number])) {
    if (currentMode === "enforce") {
      throw new RawInteractionForbiddenError(method)
    }
  }
}
