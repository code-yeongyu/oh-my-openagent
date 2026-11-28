import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { signalOwnSupervisorGroup } from "./supervisor-process-identity"

/** The model is not released until a second member of the detached group is listening. */
export async function startGroupGuard(entry: string) {
  const guard = spawn(process.execPath, [entry, "--group-guard", String(process.pid)], {
    detached: false,
    // stdin receives commands; on native POSIX stdout holds the independent EOF witness.
    stdio: [4, process.platform === "win32" ? "ignore" : 5, "inherit", "ipc"],
    windowsHide: true,
  })
  await new Promise<void>((resolve, reject) => {
    guard.once("error", reject)
    guard.once("exit", () => reject(new Error("group guard exited before ready")))
    guard.once("message", (message) =>
      message === "ready" ? resolve() : reject(new Error("unexpected group guard handshake")),
    )
  })
  let finished = false
  guard.once("exit", () => {
    if (!finished) signalOwnSupervisorGroup(process.pid, "SIGKILL")
  })
  return () => {
    finished = true
    if (guard.connected) guard.send("finished")
  }
}

export function runGroupGuard(leaderPid: number): void {
  if (!process.send || process.ppid !== leaderPid) throw new Error("group guard requires its bootstrap parent")
  process.on("SIGTERM", () => {})
  process.on("SIGINT", () => {})
  const kill = () => {
    signalOwnSupervisorGroup(leaderPid, "SIGKILL")
    process.exit(0) // The injected Windows-hosted signal command cannot kill its caller's group.
  }
  // Only the bootstrap owns the other IPC endpoint. Unexpected EOF is sufficient to
  // contain the group: this guard is *itself* still a member at the kill syscall.
  process.once("disconnect", kill)
  process.on("message", (message) => {
    if (message === "finished") {
      process.off("disconnect", kill)
      process.exit(0)
    }
  })
  // stdin is the private supervisor-to-guard command pipe, not the model's stdin.
  // EOF here means the supervisor died; the bootstrap still enforces its deadlines.
  createInterface({ input: process.stdin }).on("line", (line) => {
    if (line === "SIGKILL" || line === "SIGTERM") signalOwnSupervisorGroup(leaderPid, line)
  })
  process.send("ready")
}
