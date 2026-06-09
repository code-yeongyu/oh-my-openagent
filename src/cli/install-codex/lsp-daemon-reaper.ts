import { readFile, readdir, rm } from "node:fs/promises"
import { join } from "node:path"

export interface ReapLspDaemonsDeps {
  readonly killProcess?: (pid: number) => boolean
}

export async function reapLspDaemons(codexHome: string, deps: ReapLspDaemonsDeps = {}): Promise<readonly number[]> {
  const killProcess = deps.killProcess ?? sendSigterm
  const daemonRoot = join(codexHome, "codex-lsp", "daemon")
  const reaped: number[] = []

  let entries: string[]
  try {
    entries = await readdir(daemonRoot)
  } catch {
    return reaped
  }

  for (const entry of entries) {
    const versionDir = join(daemonRoot, entry)
    const pid = await readPidFile(join(versionDir, "daemon.pid"))
    if (pid !== null && killProcess(pid)) reaped.push(pid)
    await rm(versionDir, { recursive: true, force: true })
  }

  return reaped
}

async function readPidFile(path: string): Promise<number | null> {
  try {
    const pid = Number.parseInt((await readFile(path, "utf8")).trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function sendSigterm(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM")
    return true
  } catch {
    return false
  }
}
