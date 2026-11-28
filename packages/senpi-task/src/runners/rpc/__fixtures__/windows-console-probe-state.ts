import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, watch } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"

export type ProbeMode = "visible-control" | "hidden-fixed"

export type ParentReady = {
  readonly pid: number
  readonly catalogPid: number
  readonly catalogMainWindowHandle: number
  readonly catalogChildExited: boolean
  readonly stdioRoundTrip: true
  readonly mode: ProbeMode
  readonly parentConsoleDetached: true
}

export type ProbeCase = ParentReady & {
  readonly consoleAttached: boolean
  readonly consoleAttachError: number
  readonly consoleWindowHandle: number
  readonly consoleWindowVisible: boolean
  readonly mainWindowHandle: number
  readonly expectedVisible: boolean
  readonly childExited: boolean
  readonly parentExitCode: number
}

// Secret-bearing files are compared by mode and size only; their contents are never read (#15311).
const SECRET_FILES = new Set(["auth.json", "models.json"])
const statText = (path: string): string => {
  const stat = lstatSync(path)
  return `stat ${(stat.mode & 0o7777).toString(8)} ${stat.size}`
}

export function credentialDigests(credentialFiles: readonly string[]): Readonly<Record<string, string>> {
  const roots = [join(homedir(), ".omo", "agent"), join(homedir(), ".senpi", "agent")]
  const result: Record<string, string> = {}
  for (const root of roots) {
    for (const name of credentialFiles) {
      const path = join(root, name)
      result[path] = !existsSync(path)
        ? "missing"
        : SECRET_FILES.has(name)
          ? statText(path)
          : createHash("sha256").update(readFileSync(path)).digest("hex")
    }
  }
  return result
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function waitForFile(path: string, signal: AbortSignal): Promise<void> {
  if (existsSync(path)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const watcher = watch(dirname(path), () => {
      if (existsSync(path)) finish()
    })
    const abort = (): void => {
      cleanup()
      reject(signal.reason instanceof Error ? signal.reason : new Error(`Timed out waiting for ${basename(path)}`))
    }
    const cleanup = (): void => {
      watcher.close()
      signal.removeEventListener("abort", abort)
    }
    const finish = (): void => {
      cleanup()
      resolve()
    }
    signal.addEventListener("abort", abort, { once: true })
    if (existsSync(path)) finish()
  })
}
