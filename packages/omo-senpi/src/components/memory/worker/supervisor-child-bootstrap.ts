import { spawn } from "node:child_process"
import { writeSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"
import { CHILD_EXIT_FILENAME, readRunJson, writeRunJsonAtomic, type RunChildExit, type RunLaunchManifest } from "./run-artifacts"
import { getSupervisorRuntimePlatform, readSupervisorClockNow, scheduleSupervisorDeadline, signalSupervisorProcessGroup, terminateSupervisorChildGracefully, terminateSupervisorChildHard, type SupervisorChildExit } from "./supervisor-process-identity"

async function readRelease(): Promise<boolean> {
  for await (const chunk of process.stdin) {
    if (Buffer.byteLength(chunk) > 0) return true
  }
  return false
}

function writeBootstrapStatus(status: SupervisorChildExit): void {
  try {
    writeSync(3, `${JSON.stringify(status)}\n`)
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || !["EPIPE", "EBADF"].includes(String(error.code))) throw error
  }
}

export async function runChildBootstrap(runDir: string): Promise<void> {
  if (!(await readRelease())) return
  const manifest = await readRunJson<RunLaunchManifest>(join(runDir, "launch.json"))
  const platform = getSupervisorRuntimePlatform()
  const child = spawn(manifest.command, [...manifest.args], {
    cwd: manifest.cwd,
    env: manifest.env,
    detached: false,
    stdio: ["ignore", "inherit", "inherit"],
    // The bootstrap itself runs without a console on win32, so a console-subsystem child would
    // allocate a fresh visible one for the whole run unless it is created hidden.
    windowsHide: true,
  })
  writeBootstrapStatus({ code: child.pid ?? null, signal: "MODEL_PID" })
  const cascadeGraceful = () => {
    if (platform === "win32" || process.platform === "win32") child.kill()
  }
  process.on("SIGTERM", cascadeGraceful)
  process.on("SIGINT", cascadeGraceful)
  let deadlineFired = false
  const cancelTerm = scheduleSupervisorDeadline(manifest.hardDeadlineAt, () => {
    deadlineFired = true
    if (platform === "win32") terminateSupervisorChildGracefully(platform, child)
    else signalSupervisorProcessGroup(process.pid, "SIGTERM")
  })
  const cancelKill = scheduleSupervisorDeadline(manifest.hardDeadlineAt + manifest.terminationGraceMs, () => {
    deadlineFired = true
    terminateSupervisorChildHard(platform, process.pid)
  })
  const status = await new Promise<SupervisorChildExit>((resolve) => {
    let settled = false
    child.once("error", () => {
      if (settled) return
      settled = true
      resolve({ code: null, signal: null })
    })
    child.once("close", (code, signal) => {
      if (settled) return
      settled = true
      resolve({ code, signal })
    })
  }).finally(() => {
    cancelTerm()
    cancelKill()
  })
  // Durable before it is reported: a supervisor that dies after this point loses the pipe message,
  // and recovery may only trust a tip whose child is recorded as having finished cleanly in time.
  await writeRunJsonAtomic(join(runDir, CHILD_EXIT_FILENAME), {
    version: 1,
    runId: manifest.runId,
    attempt: manifest.attempt,
    code: status.code,
    signal: status.signal,
    finishedAt: new Date().toISOString(),
    timedOut: deadlineFired || reachedDeadline(readSupervisorClockNow(), manifest.hardDeadlineAt),
  } satisfies RunChildExit)
  writeBootstrapStatus(status)
}

/** A clock the bootstrap cannot read counts as past the deadline, so recovery stays closed. */
function reachedDeadline(now: number, hardDeadlineAt: number): boolean {
  return !Number.isFinite(now) || now >= hardDeadlineAt
}
