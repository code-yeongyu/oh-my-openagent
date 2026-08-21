// Drives the REAL production termination path (terminateSupervisorChildHard ->
// spawnTerminationCommand, the taskkill tree-kill used by the reflection supervisor) from inside a
// DETACHED, console-less parent — exactly the process shape the supervisor runs as on win32 — and
// asks Win32 whether the spawned command owns a VISIBLE console window.
//
// The taskkill command itself is swapped through the module's own documented test seam
// (OMO_MEMORY_SUPERVISOR_TASKKILL_COMMAND) for a long-lived stand-in, so the child can be probed
// while alive. Everything else — the spawn call and its options — is production code.
//
// Usage: node qa-taskkill-console.mjs <label>
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const label = process.argv[2] ?? "run"
const repoRoot = process.cwd()
const bunExe = process.env.BUN_EXE ?? "bun"
const workDir = mkdtempSync(join(tmpdir(), "omo-taskkill-qa-"))

function powershell(source) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", source], {
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.status !== 0) throw new Error(`powershell failed: ${result.stderr.trim()}`)
  return result.stdout.trim()
}

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
    "$errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()",
    "$windowHandle = [OmoConsoleProbe]::GetConsoleWindow()",
    "$windowVisible = if ($windowHandle -ne 0) { [OmoConsoleProbe]::IsWindowVisible($windowHandle) } else { $false }",
    "[Console]::Out.Write((@{ attached = $attached; errorCode = $errorCode; windowHandle = [int64]$windowHandle; windowVisible = $windowVisible } | ConvertTo-Json -Compress))",
    "if ($attached) { [OmoConsoleProbe]::FreeConsole() | Out-Null }",
  ].join("\n")
  return JSON.parse(powershell(source))
}

function sleep(ms) {
  spawnSync(process.execPath, ["-e", `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms})`])
}

// Stand-in for taskkill.exe: a console-subsystem process that stays alive long enough to probe.
const standIn = join(workDir, "stand-in.mjs")
writeFileSync(standIn, "setTimeout(() => {}, 10000)\n", "utf8")

// Runs inside the detached, console-less parent and calls the real production function.
const driver = join(workDir, "driver.mjs")
writeFileSync(
  driver,
  `import { writeFileSync } from "node:fs"
import { terminateSupervisorChildHard } from ${JSON.stringify(
    join(repoRoot, "packages/omo-senpi/src/components/memory/worker/supervisor-process-identity.ts").split("\\").join("/"),
  )}

const before = new Set(process.argv.slice(3).map(Number))
terminateSupervisorChildHard("win32", 999999)
writeFileSync(process.argv[2], "spawned\\n", "utf8")
setTimeout(() => {}, 12000)
`,
  "utf8",
)

const doneFile = join(workDir, "done.txt")
const parent = spawn(bunExe, [driver, doneFile], {
  detached: true,
  stdio: "ignore",
  windowsHide: true,
  env: {
    ...process.env,
    OMO_MEMORY_SUPERVISOR_ALLOW_TEST_SEAMS: "1",
    OMO_MEMORY_SUPERVISOR_TASKKILL_COMMAND: JSON.stringify([process.execPath, standIn]),
  },
})
parent.unref()

const deadline = Date.now() + 30_000
let ready = false
while (Date.now() < deadline && !ready) {
  try {
    ready = readFileSync(doneFile, "utf8").includes("spawned")
  } catch {
    sleep(250)
  }
}
sleep(1500)

// The stand-in is the only node.exe child of the detached parent.
const children = JSON.parse(
  powershell(
    `[Console]::Out.Write((ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${parent.pid}' | ForEach-Object { @{ pid = $_.ProcessId; name = $_.Name } })))`,
  ),
)

const report = {
  label,
  driverStarted: ready,
  parentPid: parent.pid,
  terminationChildren: children.map((child) => ({ ...child, console: consoleAttachment(child.pid) })),
}
report.visibleConsoleWindows = report.terminationChildren.filter((child) => child.console.windowVisible).length
console.log(JSON.stringify(report, null, 2))

spawnSync("taskkill", ["/pid", String(parent.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
