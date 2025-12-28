import { spawn } from "bun"

type Platform = "darwin" | "linux" | "win32" | "unsupported"

let notifySendPath: string | null = null
let notifySendPromise: Promise<string | null> | null = null

let osascriptPath: string | null = null
let osascriptPromise: Promise<string | null> | null = null

let powershellPath: string | null = null
let powershellPromise: Promise<string | null> | null = null

let afplayPath: string | null = null
let afplayPromise: Promise<string | null> | null = null

let paplayPath: string | null = null
let paplayPromise: Promise<string | null> | null = null

let aplayPath: string | null = null
let aplayPromise: Promise<string | null> | null = null

async function findCommand(commandName: string): Promise<string | null> {
  const isWindows = process.platform === "win32"
  const cmd = isWindows ? "where" : "which"

  try {
    const proc = spawn([cmd, commandName], {
      stdout: "pipe",
      stderr: "pipe",
    })

    const exitCode = await proc.exited
    if (exitCode !== 0) {
      return null
    }

    const stdout = await new Response(proc.stdout).text()
    const path = stdout.trim().split("\n")[0]

    if (!path) {
      return null
    }

    return path
  } catch {
    return null
  }
}

export async function getNotifySendPath(): Promise<string | null> {
  if (notifySendPath !== null) return notifySendPath
  if (notifySendPromise) return notifySendPromise

  notifySendPromise = (async () => {
    const path = await findCommand("notify-send")
    notifySendPath = path
    return path
  })()

  return notifySendPromise
}

export async function getOsascriptPath(): Promise<string | null> {
  if (osascriptPath !== null) return osascriptPath
  if (osascriptPromise) return osascriptPromise

  osascriptPromise = (async () => {
    const path = await findCommand("osascript")
    osascriptPath = path
    return path
  })()

  return osascriptPromise
}

export async function getPowershellPath(): Promise<string | null> {
  if (powershellPath !== null) return powershellPath
  if (powershellPromise) return powershellPromise

  powershellPromise = (async () => {
    const path = await findCommand("powershell")
    powershellPath = path
    return path
  })()

  return powershellPromise
}

export async function getAfplayPath(): Promise<string | null> {
  if (afplayPath !== null) return afplayPath
  if (afplayPromise) return afplayPromise

  afplayPromise = (async () => {
    const path = await findCommand("afplay")
    afplayPath = path
    return path
  })()

  return afplayPromise
}

export async function getPaplayPath(): Promise<string | null> {
  if (paplayPath !== null) return paplayPath
  if (paplayPromise) return paplayPromise

  paplayPromise = (async () => {
    const path = await findCommand("paplay")
    paplayPath = path
    return path
  })()

  return paplayPromise
}

export async function getAplayPath(): Promise<string | null> {
  if (aplayPath !== null) return aplayPath
  if (aplayPromise) return aplayPromise

  aplayPromise = (async () => {
    const path = await findCommand("aplay")
    aplayPath = path
    return path
  })()

  return aplayPromise
}

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
