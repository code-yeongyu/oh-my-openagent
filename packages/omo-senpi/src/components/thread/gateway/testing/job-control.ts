import { execFileSync } from "node:child_process"

/**
 * Suspends and resumes a real process for the tests that hold the gateway write lock in a stopped
 * process. bun's `Subprocess.kill("<name>")` sends the Linux signal number on darwin (bun 1.4.2:
 * "SIGSTOP" arrives as SIGCONT and "SIGCONT" as SIGTSTP), so a child stopped through it is never
 * stopped on macOS, and its "SIGCONT" stops it for good. `process.kill` resolves the name for the
 * running platform. Each call returns only once the kernel reports the new job-control state, so a
 * test never proceeds on the assumption that a signal landed.
 */

const STATE_WAIT_MS = 10_000
const POLL_MS = 5

export async function suspendProcess(pid: number): Promise<void> {
  process.kill(pid, "SIGSTOP")
  await untilState(pid, "stopped")
}

export async function resumeProcess(pid: number): Promise<void> {
  process.kill(pid, "SIGCONT")
  await untilState(pid, "running")
}

function isStopped(pid: number): boolean {
  return execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8", windowsHide: true }).trim().startsWith("T")
}

async function untilState(pid: number, state: "stopped" | "running"): Promise<void> {
  const deadline = performance.now() + STATE_WAIT_MS
  while (isStopped(pid) !== (state === "stopped")) {
    if (performance.now() > deadline) throw new Error(`process ${pid} did not report ${state} within ${STATE_WAIT_MS} ms after its signal`)
    await Bun.sleep(POLL_MS)
  }
}
