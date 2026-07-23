import type { TmuxServerAccess, TmuxServerTarget } from "./types"
import { isServerRunning } from "./tmux-utils/server-health"

export type TmuxServerHealthCheck = (serverUrl: string) => Promise<boolean>

const EMPTY_PANE_ENVIRONMENT = Object.freeze({})

export function getHttpServerOriginForLog(serverUrl: string | undefined): string | undefined {
  if (!serverUrl) return undefined

  try {
    const parsed = new URL(serverUrl)
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
      return undefined
    }
    return parsed.origin
  } catch {
    return undefined
  }
}

export function normalizeTmuxServerTarget(
  target: TmuxServerTarget,
  checkServerHealth?: TmuxServerHealthCheck,
): TmuxServerAccess {
  if (typeof target !== "string") {
    if (!checkServerHealth) return target
    return {
      ...target,
      checkServerHealth: () => checkServerHealth(target.serverUrl),
    }
  }

  const healthCheck = checkServerHealth ?? isServerRunning
  return {
    serverUrl: target,
    checkServerHealth: () => healthCheck(target),
    getPaneEnvironment: () => EMPTY_PANE_ENVIRONMENT,
  }
}
