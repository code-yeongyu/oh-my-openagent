import { log } from "../../../shared"

export type ReapResult = {
  reapedPids: number[]
  livePids: number[]
  unreachableUrls: string[]
}

export type ReapDeps = {
  listTailerProcesses: () => Promise<Array<{ pid: number; url: string }>>
  probeUrl: (url: string, timeoutMs: number) => Promise<boolean>
  killPid: (pid: number) => void
}

const TAILER_SCRIPT_NAME = "omo-team-pane-live-tail.py"

async function listTailerProcessesLinux(): Promise<Array<{ pid: number; url: string }>> {
  const { readdirSync, readFileSync } = await import("node:fs")
  const results: Array<{ pid: number; url: string }> = []

  let entries: string[]
  try {
    entries = readdirSync("/proc")
  } catch {
    return results
  }

  for (const entry of entries) {
    const pid = parseInt(entry, 10)
    if (isNaN(pid)) continue

    try {
      const cmdlineRaw = readFileSync(`/proc/${pid}/cmdline`, "utf8")
      const args = cmdlineRaw.split("\0").filter((a) => a.length > 0)
      const scriptIndex = args.findIndex((a) => a.endsWith(TAILER_SCRIPT_NAME))
      if (scriptIndex === -1) continue
      const url = args[scriptIndex + 1]
      if (!url) continue
      results.push({ pid, url })
    } catch {
      // process may have exited or no permission
    }
  }

  return results
}

async function listTailerProcessesDarwin(): Promise<Array<{ pid: number; url: string }>> {
  const { spawn } = await import("node:child_process")
  return new Promise((resolve) => {
    const results: Array<{ pid: number; url: string }> = []
    const proc = spawn("ps", ["-axo", "pid=,command="])
    let stdout = ""

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    proc.on("close", () => {
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const spaceIdx = trimmed.indexOf(" ")
        if (spaceIdx === -1) continue
        const pidStr = trimmed.slice(0, spaceIdx).trim()
        const command = trimmed.slice(spaceIdx + 1).trim()
        const pid = parseInt(pidStr, 10)
        if (isNaN(pid)) continue
        const args = command.split(" ")
        const scriptIndex = args.findIndex((a) => a.endsWith(TAILER_SCRIPT_NAME))
        if (scriptIndex === -1) continue
        const url = args[scriptIndex + 1]
        if (!url) continue
        results.push({ pid, url })
      }
      resolve(results)
    })

    proc.on("error", () => resolve(results))
  })
}

async function listTailerProcesses(): Promise<Array<{ pid: number; url: string }>> {
  if (process.platform === "linux") {
    return listTailerProcessesLinux()
  }
  if (process.platform === "darwin") {
    return listTailerProcessesDarwin()
  }
  log(`[team-mode] reap-stale-tailers: unsupported platform '${process.platform}', skipping reap`)
  return []
}

async function probeUrl(url: string, timeoutMs: number): Promise<boolean> {
  const base = url.replace(/\/+$/, "")
  try {
    await fetch(`${base}/path`, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) })
    return true
  } catch {
    return false
  }
}

function killPid(pid: number): void {
  process.kill(pid, "SIGTERM")
}

export const defaultDeps: ReapDeps = {
  listTailerProcesses,
  probeUrl,
  killPid,
}

export async function reapStaleTailers(opts?: {
  probeTimeoutMs?: number
  deps?: ReapDeps
}): Promise<ReapResult> {
  const deps = opts?.deps ?? defaultDeps
  const procs = await deps.listTailerProcesses()
  const byUrl = new Map<string, number[]>()
  for (const p of procs) {
    const arr = byUrl.get(p.url) ?? []
    arr.push(p.pid)
    byUrl.set(p.url, arr)
  }

  const reaped: number[] = []
  const live: number[] = []
  const unreachable: string[] = []

  await Promise.all(
    [...byUrl.entries()].map(async ([url, pids]) => {
      const ok = await deps.probeUrl(url, opts?.probeTimeoutMs ?? 1500)
      if (ok) {
        live.push(...pids)
        return
      }
      unreachable.push(url)
      for (const pid of pids) {
        try {
          deps.killPid(pid)
          reaped.push(pid)
        } catch (e) {
          log("[team-mode] reap-stale-tailers SIGTERM failed", { pid, url, error: String(e) })
        }
      }
    }),
  )

  log("[team-mode] reap-stale-tailers complete", { reaped, live, unreachable })
  return { reapedPids: reaped, livePids: live, unreachableUrls: unreachable }
}
