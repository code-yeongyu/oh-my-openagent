import { log } from "../../shared"

const ACTIVE_SESSION_STATUSES = new Set(["busy", "retry", "running"])
const KNOWN_TERMINAL_STATUSES = new Set(["idle", "interrupted"])

export function isActiveSessionStatus(type: string): boolean {
  if (ACTIVE_SESSION_STATUSES.has(type)) {
    return true
  }

  if (!KNOWN_TERMINAL_STATUSES.has(type)) {
    log("[background-agent] Unknown session status type encountered:", type)
  }

  return false
}

export function isTerminalSessionStatus(type: string): boolean {
  return KNOWN_TERMINAL_STATUSES.has(type) && type !== "idle"
}
