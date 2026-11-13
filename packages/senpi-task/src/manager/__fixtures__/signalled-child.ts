// Runs a fixture script as its own Bun process and waits on the signals it prints: READY once its imports have
// loaded, DONE once its work has finished, then its exit. The deadline is only a hang ceiling; on expiry this kills
// exactly the child it spawned (by its own pid) and reports the phase it reached plus its stdout and stderr (#9890).
import { spawn } from "node:child_process"
import { once } from "node:events"

export type ChildPhase = "spawned" | "ready" | "done" | "exited"

export type SignalledChildResult = {
  readonly pid: number
  readonly phase: ChildPhase
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export const SUBPROCESS_DEADLINE_MS = process.platform === "win32" ? 60_000 : 20_000

export async function runSignalledChild(
  args: readonly string[],
  deadlineMs: number = SUBPROCESS_DEADLINE_MS,
): Promise<SignalledChildResult> {
  const child = spawn(process.execPath, [...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } })
  const pid = child.pid ?? -1
  const state: { phase: ChildPhase } = { phase: "spawned" }
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk
    const lines = stdout.split("\n")
    if (state.phase === "spawned" && lines.includes("READY")) state.phase = "ready"
    if (state.phase === "ready" && lines.includes("DONE")) state.phase = "done"
  })
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk
  })
  const closed = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>

  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => resolve("deadline"), deadlineMs)
  })
  const outcome = await Promise.race([closed.then(() => "exited" as const), deadline])
  clearTimeout(timer)
  if (outcome === "deadline") child.kill("SIGKILL")
  const [exitCode] = await closed
  const reachedPhase = outcome === "exited" && state.phase === "done" ? "exited" : state.phase
  return { pid, phase: reachedPhase, exitCode, stdout, stderr, timedOut: outcome === "deadline" }
}

export function describeChild(result: SignalledChildResult): string {
  const how = result.timedOut ? "hit the hang deadline and was killed" : `exited with ${String(result.exitCode)}`
  return `child ${how} at phase "${result.phase}"\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
}
