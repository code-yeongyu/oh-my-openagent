// What the smoke owns on the host: the processes started under its sandbox, and the source checkout it renames aside
// so the packaged binary cannot fall back to source files.
import { execFile } from "node:child_process"
import { renameSync } from "node:fs"
import { promisify } from "node:util"

const exec = promisify(execFile)

export async function ownedProcesses(root) {
  if (process.platform === "win32") {
    const { stdout } = await exec("powershell.exe", ["-NoProfile", "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"],
    { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 })
    return JSON.parse(stdout).filter((entry) =>
      entry.ProcessId !== process.pid && entry.CommandLine?.includes(root))
      .map((entry) => ({ pid: entry.ProcessId, command: entry.CommandLine }))
  }
  const { stdout } = await exec("ps", ["-axo", "pid=,args="], {
    timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  })
  return stdout.split("\n").filter((line) => line.includes(root)).map((line) => {
    const [pid, ...args] = line.trim().split(/\s+/)
    return { pid: Number(pid), command: args.join(" ") }
  }).filter((entry) => entry.pid !== process.pid)
}

const RENAME_RETRY_CODES = new Set(["EBUSY", "EPERM", "EACCES"])
const RENAME_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 2_000, 2_000, 2_000, 2_000]

/**
 * Windows processes whose image or a loaded module lives under `tree`, or whose command line names
 * it: the ones that keep it from being renamed (#9618). The smoke's own process is excluded.
 */
async function treeHolders(tree) {
  const script = [
    "$tree = $env:OMO_SMOKE_TREE.ToLowerInvariant()",
    "Get-CimInstance Win32_Process | ForEach-Object {",
    "  $p = $_; $hit = $false",
    "  if ($p.ExecutablePath -and $p.ExecutablePath.ToLowerInvariant().StartsWith($tree)) { $hit = $true }",
    "  if ($p.CommandLine -and $p.CommandLine.ToLowerInvariant().Contains($tree)) { $hit = $true }",
    "  if (-not $hit) { try { $hit = @((Get-Process -Id $p.ProcessId -ErrorAction Stop).Modules | Where-Object { $_.FileName -and $_.FileName.ToLowerInvariant().StartsWith($tree) }).Count -gt 0 } catch {} }",
    "  if ($hit) { [pscustomobject]@{ pid = $p.ProcessId; parent = $p.ParentProcessId; image = $p.ExecutablePath; command = $p.CommandLine } }",
    "} | ConvertTo-Json -Compress",
  ].join("\n")
  const { stdout } = await exec("powershell.exe", ["-NoProfile", "-Command", script], {
    timeout: 60_000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, OMO_SMOKE_TREE: tree },
  })
  const parsed = stdout.trim() === "" ? [] : JSON.parse(stdout)
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((entry) => entry.pid !== process.pid)
}

/**
 * Renames `tree` aside. On Windows anything that still holds a handle under it makes the rename fail
 * with EBUSY/EPERM/EACCES. In CI no smoke process was found holding `.omo` (#9618); a scan of the
 * freshly written release binary is the likely holder, so only those codes are retried with a short
 * bounded backoff, and a rename that still fails names the holders it can see.
 */
export async function renameAside(tree, hidden) {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tree, hidden)
      return
    } catch (error) {
      const retryable = process.platform === "win32" && RENAME_RETRY_CODES.has(error?.code)
      if (!retryable) throw error
      if (attempt >= RENAME_RETRY_DELAYS_MS.length) {
        const holders = await treeHolders(tree).catch((query) => [{ query: String(query) }])
        const named = holders.length > 0
          ? `by: ${JSON.stringify(holders)}`
          : "by no process whose image, module or command line is under it (a file scanner or indexer holding a handle)"
        throw new Error(`${error.message}\nstill held after ${attempt + 1} attempts ${named}`)
      }
      await new Promise((settle) => setTimeout(settle, RENAME_RETRY_DELAYS_MS[attempt]))
    }
  }
}
