import { execFile, spawnSync } from "node:child_process"

// Port of senpi's pi-pty/windows-process-tree planner (senpi#4053). Keep this
// harness-neutral leaf shared by every omo caller, including Node-only LSP builds.
// Windows retains dead ParentProcessId values and reuses PIDs; taskkill /T can
// therefore adopt unrelated older processes. A snapshot still cannot prevent
// a PID being reused between enumeration and the explicit taskkill invocation.

export interface WindowsProcessRow {
  readonly pid: number
  readonly parentPid: number
  readonly createdAt: bigint
  readonly name: string
}

const LISTING_TIMEOUT_MS = 5_000
const LISTING_MAX_BUFFER = 16 * 1024 * 1024
const ROWS_SCRIPT = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID } | ForEach-Object {
$created = if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }
"{0} {1} {2} {3}" -f $_.ProcessId, $_.ParentProcessId, $created, $_.Name }`

const PROTECTED_IMAGES = new Set([
  "system", "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe",
  "services.exe", "lsass.exe", "lsaiso.exe", "svchost.exe",
])

export function parseWindowsProcessTreeRows(stdout: string): WindowsProcessRow[] {
  const rows: WindowsProcessRow[] = []
  for (const line of stdout.split(/\r?\n/u)) {
    const [pidText, parentText, createdText, ...nameParts] = line.trim().split(/\s+/u)
    const pid = Number(pidText)
    const parentPid = Number(parentText)
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(parentPid) || !/^\d+$/u.test(createdText ?? "")) continue
    rows.push({ pid, parentPid, createdAt: BigInt(createdText ?? "0"), name: nameParts.join(" ") })
  }
  return rows
}

function windowsTreeKillPids(rows: readonly WindowsProcessRow[], rootPid: number, selfPid: number): number[] {
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  if (!byPid.has(rootPid)) return []
  const tree = new Set([rootPid])
  let grew = true
  while (grew) {
    grew = false
    for (const row of rows) {
      if (tree.has(row.pid) || !tree.has(row.parentPid)) continue
      const parent = byPid.get(row.parentPid)
      if (parent === undefined || parent.createdAt <= 0n || row.createdAt <= 0n || row.createdAt < parent.createdAt) continue
      tree.add(row.pid)
      grew = true
    }
  }
  const ancestors = new Set([selfPid])
  for (let current = byPid.get(selfPid); current !== undefined;) {
    const parent = byPid.get(current.parentPid)
    if (parent === undefined || ancestors.has(parent.pid) || parent.createdAt > current.createdAt) break
    ancestors.add(parent.pid)
    current = parent
  }
  const refused = [...tree].filter((pid) =>
    PROTECTED_IMAGES.has((byPid.get(pid)?.name ?? "").toLowerCase()) || ancestors.has(pid))
  if (refused.length === 0) return [...tree]
  return refused.includes(rootPid) ? [] : [rootPid]
}

/**
 * Explicit taskkill targets, never /T. A failed listing targets only the owned
 * root: descendants are unverified and may survive. A successful listing with
 * no eligible root targets nothing. `force` preserves graceful sweep callers.
 */
export function windowsTreeKillArgs(
  rootPid: number,
  rows: readonly WindowsProcessRow[] | undefined,
  selfPid = process.pid,
  force = true,
): string[] {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0 || rootPid === selfPid) return []
  const pids = rows === undefined ? [rootPid] : windowsTreeKillPids(rows, rootPid, selfPid)
  if (pids.length === 0) return []
  return [...(force ? ["/F"] : []), ...pids.flatMap((pid) => ["/PID", String(pid)])]
}

export function listWindowsProcessRowsSync(): WindowsProcessRow[] | undefined {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ROWS_SCRIPT], {
    encoding: "utf8", windowsHide: true, timeout: LISTING_TIMEOUT_MS, maxBuffer: LISTING_MAX_BUFFER,
  })
  if (result.error !== undefined || result.status !== 0 || typeof result.stdout !== "string") return undefined
  const rows = parseWindowsProcessTreeRows(result.stdout)
  return rows.length > 0 ? rows : undefined
}

export function listWindowsProcessRows(): Promise<WindowsProcessRow[] | undefined> {
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ROWS_SCRIPT], {
      encoding: "utf8", windowsHide: true, timeout: LISTING_TIMEOUT_MS, maxBuffer: LISTING_MAX_BUFFER,
    }, (error, stdout) => {
      const rows = error ? [] : parseWindowsProcessTreeRows(stdout)
      resolve(rows.length > 0 ? rows : undefined)
    })
  })
}
