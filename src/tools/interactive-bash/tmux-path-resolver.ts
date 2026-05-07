import { spawn } from "../../shared/bun-spawn-shim"

let tmuxPath: string | null = null
let initPromise: Promise<string | null> | null = null
let tmuxPathEnvironmentKey: "cmux" | "tmux" | null = null

function isCmuxCompatEnvironment(): boolean {
  return Boolean(process.env.CMUX_SOCKET_PATH) ||
    process.env.TMUX?.includes("cmuxterm") === true
}

function getEnvironmentKey(): "cmux" | "tmux" {
  return isCmuxCompatEnvironment() ? "cmux" : "tmux"
}

async function findCommandPath(command: string): Promise<string | null> {
  const isWindows = process.platform === "win32"
  const cmd = isWindows ? "where" : "which"

  try {
    const proc = spawn([cmd, command], {
      env: process.env,
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

async function findVerifiedTmuxPath(): Promise<string | null> {
  const path = await findCommandPath("tmux")
  if (!path) {
    return null
  }

  try {
    const verifyProc = spawn([path, "-V"], {
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    })

    const verifyExitCode = await verifyProc.exited
    if (verifyExitCode !== 0) {
      return null
    }

    return path
  } catch {
    return null
  }
}

async function findTmuxPath(): Promise<string | null> {
  if (isCmuxCompatEnvironment()) {
    const cmuxPath = await findCommandPath("cmux")
    if (cmuxPath) {
      return cmuxPath
    }
  }

  return findVerifiedTmuxPath()
}

export async function getTmuxPath(): Promise<string | null> {
  const environmentKey = getEnvironmentKey()
  if (tmuxPath !== null && tmuxPathEnvironmentKey === environmentKey) {
    return tmuxPath
  }

  if (initPromise && tmuxPathEnvironmentKey === environmentKey) {
    return initPromise
  }

  tmuxPathEnvironmentKey = environmentKey
  const promiseEnvironmentKey = environmentKey
  initPromise = (async () => {
    const path = await findTmuxPath()
    if (tmuxPathEnvironmentKey === promiseEnvironmentKey) {
      tmuxPath = path
    }
    return path
  })()

  return initPromise
}

export function getCachedTmuxPath(): string | null {
  return tmuxPath
}

export function resetTmuxPathCacheForTesting(): void {
  tmuxPath = null
  initPromise = null
  tmuxPathEnvironmentKey = null
}

export function startBackgroundCheck(): void {
  if (!initPromise) {
    initPromise = getTmuxPath()
    initPromise.catch(() => {})
  }
}
