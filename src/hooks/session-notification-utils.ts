import { spawn } from "bun"

type Platform = "darwin" | "linux" | "win32" | "unsupported"

async function findCommand(commandName: string): Promise<string | null> {
  try {
    return Bun.which(commandName)
  } catch {
    return null
  }
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

export function startBackgroundCheck(platform: Platform): void {
  if (platform === "darwin") {
    getOsascriptPath().catch(() => {})
    getAfplayPath().catch(() => {})
  } else if (platform === "linux") {
    getNotifySendPath().catch(() => {})
    getPaplayPath().catch(() => {})
    getAplayPath().catch(() => {})
  } else if (platform === "win32") {
    getPowershellPath().catch(() => {})
  }
}
