#!/usr/bin/env node
import { spawn } from "node:child_process"
import { closeSync, openSync, writeSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  readRunJson,
  unlinkRunArtifact,
  updateRunLedger,
  type RunLaunchManifest,
  type RunOutcome,
} from "./run-artifacts"
import {
  getSupervisorProcessStart,
  getSupervisorRuntimePlatform,
  parseSupervisorChildExit,
  readSupervisorClockNow,
  recordSupervisorGracefulDeadline,
  scheduleSupervisorDeadline,
  signalSupervisorProcessGroup,
  terminateSupervisorChildGracefully,
  terminateSupervisorChildHard,
  type SupervisorChildExit,
} from "./supervisor-process-identity"
import { publishRunOutcome } from "./run-outcome-publication"

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

async function runChildBootstrap(runDir: string): Promise<void> {
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
  const cancelTerm = scheduleSupervisorDeadline(manifest.hardDeadlineAt, () => {
    if (platform === "win32") terminateSupervisorChildGracefully(platform, child)
    else signalSupervisorProcessGroup(process.pid, "SIGTERM")
  })
  const cancelKill = scheduleSupervisorDeadline(manifest.hardDeadlineAt + manifest.terminationGraceMs, () => {
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
  writeBootstrapStatus(status)
}

async function runSupervisor(runDir: string): Promise<void> {
  const launchPath = join(runDir, "launch.json")
  const ledgerPath = join(runDir, "ledger.json")
  const manifest = await readRunJson<RunLaunchManifest>(launchPath)
  const platform = getSupervisorRuntimePlatform()
  await updateRunLedger(ledgerPath, {
    launching: false,
    pid: process.pid,
    processStart: await getSupervisorProcessStart(process.pid),
  })

  const stdoutFd = openSync(manifest.stdoutPath, "w")
  const stderrFd = openSync(manifest.stderrPath, "w")
  const bootstrap = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child-bootstrap", runDir], {
    env: process.env,
    // POSIX keeps a detached process group so the group kill reaches the whole tree. On win32 the
    // bootstrap must stay inside the supervisor: Windows Terminal can hand a detached child a fresh
    // visible console even with windowsHide, and an abrupt supervisor exit should take the
    // bootstrap down instead of orphaning it.
    detached: platform !== "win32",
    stdio: ["pipe", stdoutFd, stderrFd, "pipe"],
    windowsHide: true,
  })
  let childPid = bootstrap.pid
  let modelPid: number | undefined
  let bootstrapStatus = ""
  const control = bootstrap.stdio[3]
  if (control !== undefined && control !== null && "setEncoding" in control) {
    control.setEncoding("utf8")
    control.on("data", (chunk: string) => {
      bootstrapStatus += chunk
      for (const line of bootstrapStatus.split("\n")) {
        try {
          const message = JSON.parse(line) as Record<string, unknown>
          if (message.signal === "MODEL_PID" && typeof message.code === "number") modelPid = message.code
        } catch (error) {
          if (!(error instanceof SyntaxError)) throw error
        }
      }
    })
  }

  const containChild = (synchronous = false) => {
    try {
      terminateSupervisorChildHard(platform, childPid, synchronous)
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
  process.once("exit", () => containChild(true))
  process.once("SIGTERM", () => {
    containChild()
    childPid = undefined
    process.exit(143)
  })
  process.once("SIGINT", () => {
    containChild()
    childPid = undefined
    process.exit(130)
  })

  if (bootstrap.pid === undefined) throw new Error("child bootstrap did not receive a pid")
  await updateRunLedger(ledgerPath, {
    childPid: bootstrap.pid,
    childProcessStart: await getSupervisorProcessStart(bootstrap.pid),
  })
  bootstrap.stdin?.end("1\n")

  let timedOut = false
  let hardKillFinished = Promise.resolve()
  let finishHardKill: (() => void) | undefined
  if (platform === "win32") hardKillFinished = new Promise<void>((resolve) => { finishHardKill = resolve })
  const cancelTerm = scheduleSupervisorDeadline(manifest.hardDeadlineAt, () => {
    timedOut = true
    if (platform === "win32") recordSupervisorGracefulDeadline(bootstrap.pid)
    else terminateSupervisorChildGracefully(platform, bootstrap)
  })
  const cancelKill = scheduleSupervisorDeadline(manifest.hardDeadlineAt + manifest.terminationGraceMs, () => {
    terminateSupervisorChildHard(platform, modelPid ?? childPid)
    finishHardKill?.()
  })
  const wrapperExit = await new Promise<SupervisorChildExit>((resolve, reject) => {
    let settled = false
    bootstrap.once("error", (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    bootstrap.once("close", (code, signal) => {
      if (settled) return
      settled = true
      resolve({ code, signal })
    })
  })
  const childExit = parseSupervisorChildExit(bootstrapStatus)
  if (platform === "win32" && timedOut && childExit === undefined) await hardKillFinished
  cancelTerm()
  cancelKill()
  childPid = undefined
  closeSync(stdoutFd)
  closeSync(stderrFd)

  // Record the timeout from whether the deadline instant was actually reached, not from which
  // process's deadline callback happened to run first: the bootstrap's own enforcement can end
  // the child before the supervisor's callback fires, and the cancels above would otherwise
  // erase a deadline that was in fact exceeded.
  const clockNow = readSupervisorClockNow()
  const finishedAt = new Date().toISOString()
  const outcome: RunOutcome = {
    version: 1,
    runId: manifest.runId,
    attempt: manifest.attempt,
    finishedAt,
    childExit: childExit ?? wrapperExit,
    timedOut: timedOut || (Number.isFinite(clockNow) && clockNow >= manifest.hardDeadlineAt),
  }
  await publishRunOutcome(runDir, manifest, outcome)
  await unlinkRunArtifact(launchPath)
  process.exit(0)
}
const args = process.argv.slice(2)
try {
  if (args[0] === "--child-bootstrap") {
    if (args[1] === undefined) throw new TypeError("run directory is required")
    await runChildBootstrap(args[1])
  } else {
    if (args[0] === undefined) throw new TypeError("run directory is required")
    await runSupervisor(args[0])
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
}
