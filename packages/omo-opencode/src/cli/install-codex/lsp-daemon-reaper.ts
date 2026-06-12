import { readFile, readdir, rm } from "node:fs/promises"
import { connect } from "node:net"
import { join } from "node:path"

export interface ReapLspDaemonsDeps {
  readonly killProcess?: (pid: number) => boolean
  readonly isDaemonLive?: (socketPath: string) => Promise<boolean>
}

export async function reapLspDaemons(codexHome: string, deps: ReapLspDaemonsDeps = {}): Promise<readonly number[]> {
  const killProcess = deps.killProcess ?? sendSigterm
  const isDaemonLive = deps.isDaemonLive ?? probeSocketLive
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
    const socketPath = await readEndpointFile(join(versionDir, "daemon.endpoint"))
    if (pid !== null && socketPath !== null && (await isDaemonLive(socketPath)) && killProcess(pid)) {
      reaped.push(pid)
    }
    await rm(versionDir, { recursive: true, force: true })
  }

  return reaped
}

async function readEndpointFile(path: string): Promise<string | null> {
  try {
    const content = (await readFile(path, "utf8")).trim()
    return content.length > 0 ? content : null
  } catch {
    return null
  }
}

async function readPidFile(path: string): Promise<number | null> {
  try {
    const pid = Number.parseInt((await readFile(path, "utf8")).trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function probeSocketLive(socketPath: string, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(socketPath)
    const done = (ok: boolean): void => {
      socket.destroy()
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    timer.unref()
    socket.once("connect", () => {
      clearTimeout(timer)
      done(true)
    })
    socket.once("error", () => {
      clearTimeout(timer)
      done(false)
    })
  })
}

function sendSigterm(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM")
    return true
  } catch {
    return false
  }
}
