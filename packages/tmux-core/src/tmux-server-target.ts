import type { TmuxPaneEnvironment, TmuxServerAccess, TmuxServerTarget } from "./types"
import { isServerRunning } from "./tmux-utils/server-health"

export type TmuxServerHealthCheck = (serverUrl: string) => Promise<boolean>

const EMPTY_TMUX_PANE_ENVIRONMENT: TmuxPaneEnvironment = Object.freeze({})

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
    const getReadyPaneEnvironment = async (): Promise<TmuxPaneEnvironment | null> => (
      await checkServerHealth(target.serverUrl) ? target.getPaneEnvironment() : null
    )
    return {
      ...target,
      checkServerHealth: async () => await getReadyPaneEnvironment() !== null,
      getReadyPaneEnvironment,
    }
  }

  const healthCheck = checkServerHealth ?? isServerRunning
  const getReadyPaneEnvironment = async (): Promise<TmuxPaneEnvironment | null> => (
    await healthCheck(target) ? EMPTY_TMUX_PANE_ENVIRONMENT : null
  )
  return {
    serverUrl: target,
    checkServerHealth: async () => await getReadyPaneEnvironment() !== null,
    getPaneEnvironment: () => EMPTY_TMUX_PANE_ENVIRONMENT,
    getReadyPaneEnvironment,
  }
}

export async function getReadyTmuxPaneEnvironment(
  access: TmuxServerAccess,
): Promise<TmuxPaneEnvironment | null> {
  if (access.getReadyPaneEnvironment) {
    return access.getReadyPaneEnvironment()
  }
  return await access.checkServerHealth()
    ? access.getPaneEnvironment()
    : null
}
