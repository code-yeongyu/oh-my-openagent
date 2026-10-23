import { spawn, spawnSync } from "node:child_process"
import { join } from "node:path"

// One external stage of a packaging test, run without blocking the test process (#10911): it either
// settles with its output or, past `capMs`, has its whole process tree killed and awaited, and fails
// naming the stage. A `spawnSync` stage that stalls gives no clue which step hung, and a shell-launched
// child of a killed `cmd.exe` keeps files open so the scratch directory cannot be removed.
export function runBoundedStage(stage, command, args, options, capMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true })
    let stdout = ""
    let stderr = ""
    child.stdout?.setEncoding("utf8").on("data", (chunk) => { stdout += chunk })
    child.stderr?.setEncoding("utf8").on("data", (chunk) => { stderr += chunk })
    let stalled = false
    const cap = setTimeout(() => {
      stalled = true
      if (process.platform === "win32" && child.pid !== undefined) {
        spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true })
      } else {
        child.kill("SIGKILL")
      }
      // A process outside the killed tree may still hold the pipes; without them `close` can still fire.
      child.stdout?.destroy()
      child.stderr?.destroy()
    }, capMs)
    child.once("error", (error) => {
      clearTimeout(cap)
      reject(new Error(`${stage} could not start: ${error.message}`))
    })
    child.once("close", (status) => {
      clearTimeout(cap)
      if (stalled) {
        reject(new Error(`${stage} did not finish within ${capMs} ms; stdout: ${stdout.slice(-500)} stderr: ${stderr.slice(-500)}`))
        return
      }
      resolve({ status, stdout, stderr })
    })
  })
}

// The Windows `tar`, independent of PATH: under Git Bash's PATH `tar` is GNU tar, which reads `C:\...`
// as a remote host and fails.
export function systemTar() {
  return process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar"
}
