import { log } from "../shared/logger"

declare const Bun: {
  which(commandName: string): string | null
}

type Platform = "darwin" | "linux" | "win32" | "unsupported"

async function findCommand(commandName: string): Promise<string | null> {
  try {
    return Bun.which(commandName)
  } catch (error) {
    log("[session-notification] failed to resolve command path", {
      commandName,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function logBackgroundCheckError(commandName: string, error: unknown): void {
  log("[session-notification] background command check failed", {
    commandName,
    error: error instanceof Error ? error.message : String(error),
  })
}

function createCommandFinder(commandName: string): () => Promise<string | null> {
  let cachedPath: string | null = null
  let pending: Promise<string | null> | null = null

  return async () => {
    if (cachedPath !== null) return cachedPath
    if (pending) return pending

    pending = (async () => {
      const path = await findCommand(commandName)
      cachedPath = path
      return path
    })()

    return pending
  }
}

export const getNotifySendPath = createCommandFinder("notify-send")
export const getOsascriptPath = createCommandFinder("osascript")
export const getPowershellPath = createCommandFinder("powershell")
export const getAfplayPath = createCommandFinder("afplay")
export const getPaplayPath = createCommandFinder("paplay")
export const getAplayPath = createCommandFinder("aplay")
export const getTerminalNotifierPath = createCommandFinder("terminal-notifier")

export function startBackgroundCheck(platform: Platform): void {
  if (platform === "darwin") {
    getOsascriptPath().catch((error) => {
      logBackgroundCheckError("osascript", error)
    })
    getAfplayPath().catch((error) => {
      logBackgroundCheckError("afplay", error)
    })
    getTerminalNotifierPath().catch((error) => {
      logBackgroundCheckError("terminal-notifier", error)
    })
  } else if (platform === "linux") {
    getNotifySendPath().catch((error) => {
      logBackgroundCheckError("notify-send", error)
    })
    getPaplayPath().catch((error) => {
      logBackgroundCheckError("paplay", error)
    })
    getAplayPath().catch((error) => {
      logBackgroundCheckError("aplay", error)
    })
  } else if (platform === "win32") {
    getPowershellPath().catch((error) => {
      logBackgroundCheckError("powershell", error)
    })
  }
}
