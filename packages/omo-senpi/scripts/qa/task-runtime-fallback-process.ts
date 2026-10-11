import { execFileSync } from "node:child_process"

type ProcessRow = { pid: number; ppid: number; args: string; startedAt?: number }
type WindowsProcess = { ProcessId: number; ParentProcessId: number; CommandLine?: string; StartedAt?: number | null }

// One process table for both platforms: `ps` on POSIX, the CIM process list on Windows (no `ps`/`pgrep`).
function processTable(deadline: number): ProcessRow[] {
  const timeout = Math.min(5_000, deadline - Date.now())
  if (timeout <= 0) throw new Error("sandbox process query deadline expired")
  if (process.platform === "win32") {
    const json = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command",
        "$ErrorActionPreference = 'Stop'; Get-CimInstance Win32_Process -OperationTimeoutSec 5 | Select-Object ProcessId,ParentProcessId,CommandLine,@{Name='StartedAt';Expression={if ($null -ne $_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { $null }}} | ConvertTo-Json -Compress"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout },
    )
    const rows = JSON.parse(json || "[]") as WindowsProcess | WindowsProcess[]
    return (Array.isArray(rows) ? rows : [rows]).map((row) => ({
      pid: Number(row.ProcessId),
      ppid: Number(row.ParentProcessId),
      args: String(row.CommandLine ?? ""),
      startedAt: row.StartedAt == null ? undefined : Number(row.StartedAt),
    }))
  }
  const table = execFileSync("ps", ["-axo", "pid=,ppid=,args="], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout })
  return table.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    return match === null ? [] : [{ pid: Number(match[1]), ppid: Number(match[2]), args: match[3] }]
  })
}

function sandboxProcesses(sandbox: { root: string }, table: ProcessRow[]) {
  const normalize = (path: string) => process.platform === "win32" ? path.replaceAll("\\", "/").toLowerCase() : path
  const marker = normalize(sandbox.root)
  return table.filter((row) => {
    const args = normalize(row.args)
    const index = args.indexOf(marker)
    const boundary = args[index + marker.length]
    const before = index === 0 ? undefined : args[index - 1]
    return row.pid !== process.pid && index !== -1 && (before === undefined || /[\s"'=]/.test(before)) && (boundary === undefined || /[\/\s"']/.test(boundary))
  }).map((row) => row.pid)
}

function descendants(pid: number, table: ProcessRow[]): number[] {
  const parent = table.find((row) => row.pid === pid)
  const direct = table.filter((row) => row.ppid === pid && row.pid !== process.pid && (process.platform !== "win32"
    || (Number.isFinite(parent?.startedAt) && Number.isFinite(row.startedAt) && row.startedAt! >= parent!.startedAt!)))
    .map((row) => row.pid)
  return direct.flatMap((child) => [child, ...descendants(child, table)])
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false
    throw error
  }
}

function signal(pids: number[], name: NodeJS.Signals) {
  for (const pid of pids) {
    try {
      process.kill(pid, name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
    }
  }
}

// The daemon a host-session run ensured outlives the parent (it idles out after minutes). Its argv
// names the sandbox plugin, so it and its process tree are stopped before the sandbox is removed;
// the receipt fails when anything naming the sandbox, or any stopped pid, survives. Process exit of
// a non-child pid has no event to await, so the grace period is a bounded liveness re-check.
export async function stopSandboxProcesses(sandbox: { root: string }, deadline = Date.now() + 20_000) {
  const table = processTable(deadline)
  const found = sandboxProcesses(sandbox, table)
  const owned = [...new Set(found.flatMap((pid) => [pid, ...descendants(pid, table)]))]
  if (owned.length === 0) return { stopped: [], survivors: [] }
  const identities = table.filter((row) => owned.includes(row.pid))
  if (process.platform === "win32" && identities.some((row) => !Number.isFinite(row.startedAt))) {
    throw new Error("sandbox process identity could not be verified")
  }
  const stillOwned = (rows: ProcessRow[]) => identities.filter((original) => rows.some((row) =>
    row.pid === original.pid && (process.platform !== "win32" || row.startedAt === original.startedAt))).map((row) => row.pid)
  signal(owned, "SIGTERM")
  const graceDeadline = Math.min(Date.now() + 10_000, deadline - 10_000)
  while (owned.some(alive) && Date.now() < graceDeadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  // Revalidate Windows creation identities after the grace period; never escalate a reused PID.
  const remaining = stillOwned(processTable(deadline))
  signal(remaining, "SIGKILL")
  const killDeadline = deadline - 5_000
  while (remaining.some(alive) && Date.now() < killDeadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  const finalTable = processTable(deadline)
  return { stopped: owned, survivors: [...new Set([...sandboxProcesses(sandbox, finalTable), ...stillOwned(finalTable)])] }
}
