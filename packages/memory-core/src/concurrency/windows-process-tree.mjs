import { spawnSync } from "node:child_process"

// Port of senpi's agent/env/windows-process-tree.ts (#2999) for Node-compatible QA fixtures.
// ParentProcessId is never rewritten after exit; a newer PID holder is not the recorded parent.
const PROCESS_ROWS = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID } | ForEach-Object {
$created = if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }
"{0} {1} {2} {3}" -f $_.ProcessId, $_.ParentProcessId, $created, $_.Name }`
const PROTECTED_IMAGES = new Set([
  "system", "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe",
  "services.exe", "lsass.exe", "lsaiso.exe", "svchost.exe",
])

function parseRows(stdout) {
  return stdout.split(/\r?\n/u).flatMap((line) => {
    const [pidText, parentText, createdText, ...name] = line.trim().split(/\s+/u)
    const pid = Number(pidText)
    const parentPid = Number(parentText)
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(parentPid) || !/^\d+$/u.test(createdText ?? "")) return []
    return [{ pid, parentPid, createdAt: BigInt(createdText), name: name.join(" ") }]
  })
}

/** Explicit PID arguments only; a failed listing permits the owned root, never an unchecked tree. */
export function windowsTreeKillArgs(rootPid, run = spawnSync, selfPid = process.pid) {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0 || rootPid === selfPid) return []
  const result = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PROCESS_ROWS], {
    encoding: "utf8", windowsHide: true, timeout: 5_000, maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") {
    return ["/F", "/PID", String(rootPid)]
  }
  const rows = parseRows(result.stdout)
  if (rows.length === 0) return ["/F", "/PID", String(rootPid)]
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  if (!byPid.has(rootPid)) return []
  const tree = new Set([rootPid])
  let grew = true
  while (grew) {
    grew = false
    for (const row of rows) {
      if (tree.has(row.pid) || !tree.has(row.parentPid)) continue
      const parent = byPid.get(row.parentPid)
      if (!parent || parent.createdAt === 0n || row.createdAt === 0n || row.createdAt < parent.createdAt) continue
      tree.add(row.pid)
      grew = true
    }
  }
  const ancestors = new Set([selfPid])
  for (let current = byPid.get(selfPid); current !== undefined; ) {
    const parent = byPid.get(current.parentPid)
    if (!parent || ancestors.has(parent.pid) || parent.createdAt > current.createdAt) break
    ancestors.add(parent.pid)
    current = parent
  }
  const refused = [...tree].filter((pid) => ancestors.has(pid) || PROTECTED_IMAGES.has(byPid.get(pid)?.name.toLowerCase()))
  const pids = refused.length === 0 ? [...tree] : refused.includes(rootPid) ? [] : [rootPid]
  return pids.length === 0 ? [] : ["/F", ...pids.flatMap((pid) => ["/PID", String(pid)])]
}
