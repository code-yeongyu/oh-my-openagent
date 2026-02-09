import { spawn } from "bun"

let tmuxPath: string | null = null
let initPromise: Promise<string | null> | null = null

async function findTmuxPath(): Promise<string | null> {
  const isWindows = process.platform === "win32"
  const cmd = isWindows ? "where" : "which"

  try {
    const proc = spawn([cmd, "tmux"], {
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

    const verifyProc = spawn([path, "-V"], {
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

export async function getTmuxPath(): Promise<string | null> {
  if (tmuxPath !== null) {
    return tmuxPath
  }

  if (initPromise) {
    return initPromise
  }

  initPromise = (async () => {
    const path = await findTmuxPath()
    tmuxPath = path
    return path
  })()

  return initPromise
}

export function getCachedTmuxPath(): string | null {
  return tmuxPath
}

export function startBackgroundCheck(): void {
  if (!initPromise) {
    initPromise = getTmuxPath()
    initPromise.catch(() => {})
  }
}
