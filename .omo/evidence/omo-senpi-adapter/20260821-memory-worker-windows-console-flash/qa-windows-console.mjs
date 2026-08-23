// Runtime QA for the memory reflection worker's win32 console suppression.
//
// It drives the REAL supervisor chain (memory-run-supervisor.ts -> child bootstrap -> model child)
// with a harmless sleeping "model" command, then asks Win32 whether each process in that chain owns
// a console window. Before the fix every process in the chain owned a visible console; after it,
// none do.
//
// Usage: node qa-windows-console.mjs <label>
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const label = process.argv[2] ?? "run"
const repoRoot = process.cwd()
const supervisor = join(
  repoRoot,
  "packages/omo-senpi/src/components/memory/worker/memory-run-supervisor.ts",
)
const bunExe = process.env.BUN_EXE ?? "bun"

function powershell(source) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", source], {
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.status !== 0) throw new Error(`powershell failed: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

// FreeConsole + AttachConsole(pid) reports whether the target process owns a console, and
// IsWindowVisible reports whether that console is an actual window on the user's desktop.
function consoleAttachment(pid) {
  const source = [
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Runtime.InteropServices;",
    "public static class OmoConsoleProbe {",
    '  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();',
    '  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint processId);',
    '  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();',
    '  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr hWnd);',
    "}",
    "'@",
    "[OmoConsoleProbe]::FreeConsole() | Out-Null",
    `$attached = [OmoConsoleProbe]::AttachConsole(${pid})`,
    "$windowHandle = [OmoConsoleProbe]::GetConsoleWindow()",
    "$windowVisible = if ($windowHandle -ne 0) { [OmoConsoleProbe]::IsWindowVisible($windowHandle) } else { $false }",
    "[Console]::Out.Write((@{ attached = $attached; windowHandle = [int64]$windowHandle; windowVisible = $windowVisible } | ConvertTo-Json -Compress))",
    "if ($attached) { [OmoConsoleProbe]::FreeConsole() | Out-Null }",
  ].join("\n")
  return JSON.parse(powershell(source))
}

function descendants(rootPid) {
  const source = `$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name
$result = New-Object System.Collections.ArrayList
$frontier = @(${rootPid})
while ($frontier.Count -gt 0) {
  $next = @()
  foreach ($procId in $frontier) {
    foreach ($p in $all) {
      if ($p.ParentProcessId -eq $procId) {
        [void]$result.Add(@{ pid = $p.ProcessId; name = $p.Name })
        $next += $p.ProcessId
      }
    }
  }
  $frontier = $next
}
[Console]::Out.Write((ConvertTo-Json -Compress -InputObject @($result)))`
  return JSON.parse(powershell(source))
}

function conhostCount() {
  return Number(powershell("[Console]::Out.Write((Get-Process -Name conhost -ErrorAction SilentlyContinue | Measure-Object).Count)"))
}

const runDir = mkdtempSync(join(tmpdir(), "omo-console-qa-"))
const manifest = {
  version: 1,
  runId: `qa-${label}`,
  attempt: 1,
  kind: "reflection",
  command: process.execPath,
  args: ["-e", "setTimeout(() => {}, 8000)"],
  cwd: runDir,
  env: { ...process.env },
  hardDeadlineAt: Date.now() + 30_000,
  terminationGraceMs: 5_000,
  maxOutputBytes: 1_000_000,
  stdoutPath: join(runDir, "stdout.log"),
  stderrPath: join(runDir, "stderr.log"),
}
writeFileSync(join(runDir, "launch.json"), JSON.stringify(manifest), "utf8")
writeFileSync(join(runDir, "ledger.json"), JSON.stringify({ runId: manifest.runId, attempt: 1, launching: true }), "utf8")

const conhostBefore = conhostCount()
// Mirrors the production parent-side launch in spawn-supervisor.ts. The baseline run reproduces the
// pre-fix options (no windowsHide) so the A/B compares the two real code states.
const child = spawn(bunExe, [supervisor, runDir], {
  detached: true,
  stdio: "ignore",
  windowsHide: label !== "baseline",
})
child.unref()

await new Promise((resolve) => setTimeout(resolve, 4000))

const tree = [{ pid: child.pid, name: "supervisor" }, ...descendants(child.pid)]
const probes = tree.map((entry) => ({ ...entry, console: consoleAttachment(entry.pid) }))
const conhostAfter = conhostCount()

const report = {
  label,
  runDir,
  conhostBefore,
  conhostAfter,
  processes: probes,
  processesWithConsoleWindow: probes.filter((p) => p.console.windowHandle !== 0).length,
  processesWithVisibleConsoleWindow: probes.filter((p) => p.console.windowVisible).length,
}
console.log(JSON.stringify(report, null, 2))

try {
  spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
} catch {
  // best effort cleanup; the supervisor's own deadline terminates the tree anyway
}
