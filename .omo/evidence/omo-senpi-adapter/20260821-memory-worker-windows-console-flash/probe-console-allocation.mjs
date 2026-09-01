// Isolates WHICH spawn shape actually puts an empty console window on the user's desktop.
//
// Layer 1: a detached parent (DETACHED_PROCESS, i.e. no console at all) — this is the supervisor.
// Layer 2: that console-less parent spawns a console-subsystem child, once WITHOUT windowsHide and
//          once WITH it. A console app started from a console-less parent allocates a BRAND NEW
//          console, and that console owns a visible window unless CREATE_NO_WINDOW is set.
//
// Usage: node probe-console-allocation.mjs
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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
    `$main = try { [int64](Get-Process -Id ${pid} -ErrorAction Stop).MainWindowHandle } catch { -1 }`,
    "[Console]::Out.Write((@{ attached = $attached; errorCode = $errorCode; windowHandle = [int64]$windowHandle; windowVisible = $windowVisible; mainWindowHandle = $main } | ConvertTo-Json -Compress))",
    "if ($attached) { [OmoConsoleProbe]::FreeConsole() | Out-Null }",
  ].join("\n")
  return JSON.parse(powershell(source))
}

const workDir = mkdtempSync(join(tmpdir(), "omo-console-probe-"))

// The layer-1 script runs INSIDE a detached, console-less process and spawns the layer-2 console
// child with the windowsHide value under test, then reports that child's pid.
const layer1 = join(workDir, "layer1.mjs")
writeFileSync(
  layer1,
  `import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
const hide = process.argv[2] === "hide"
const child = spawn("cmd.exe", ["/c", "ping", "-n", "8", "127.0.0.1"], {
  stdio: "ignore",
  windowsHide: hide,
})
writeFileSync(process.argv[3], String(child.pid), "utf8")
setTimeout(() => {}, 9000)
`,
  "utf8",
)

function runCase(mode) {
  const pidFile = join(workDir, `${mode}.pid`)
  const parent = spawn(process.execPath, [layer1, mode, pidFile], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  })
  parent.unref()
  const deadline = Date.now() + 15_000
  let childPid
  while (Date.now() < deadline) {
    try {
      childPid = Number(readFileSync(pidFile, "utf8"))
      if (Number.isInteger(childPid) && childPid > 0) break
    } catch {
      spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)"])
    }
  }
  if (childPid === undefined) throw new Error(`${mode}: layer-2 child pid never appeared`)
  spawnSync(process.execPath, ["-e", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500)"])
  const probe = consoleAttachment(childPid)
  spawnSync("taskkill", ["/pid", String(parent.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
  return { mode, parentPid: parent.pid, childPid, console: probe }
}

const report = {
  description: "console-subsystem child (cmd.exe) spawned from a detached console-less parent",
  cases: [runCase("show"), runCase("hide")],
}
console.log(JSON.stringify(report, null, 2))
