#!/usr/bin/env node
import { spawn } from "node:child_process"
import { closeSync, openSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { maybeKillAt } from "@oh-my-opencode/memory-core"
import { runMemoryHook } from "@oh-my-opencode/memory-core/memory-hook"

import {
  unlinkRunArtifact,
  updateRunLedger,
  type RunOutcome,
} from "./run-artifacts"
import {
  getSupervisorProcessStart,
  getSupervisorRuntimePlatform,
  parseSupervisorChildExit,
  readSupervisorClockNow,
  recordSupervisorGracefulDeadline,
  scheduleSupervisorDeadline,
  terminateSupervisorChildGracefully,
  terminateSupervisorChildHard,
  type SupervisorChildExit,
} from "./supervisor-process-identity"
import { publishRunOutcome } from "./run-outcome-publication"
import { runChildBootstrap } from "./supervisor-child-bootstrap"
import { admitSupervisor } from "./supervisor-admission"


async function runSupervisor(runDir: string): Promise<void> {
  const launchPath = join(runDir, "launch.json")
  const ledgerPath = join(runDir, "ledger.json")
  const { manifest, lease } = await admitSupervisor(runDir)
  const platform = getSupervisorRuntimePlatform()
  let childPid: number | undefined
  const containChild = () => {
    try {
      terminateSupervisorChildHard(platform, childPid, true)
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      return
    }
    // An exit handler cannot await the child's close. Keep its ownership record until death is
    // proven rather than freeing capacity merely because a kill signal was sent.
    if (childPid === undefined) lease.releaseSync()
  }
  process.once("exit", containChild)
  process.once("SIGTERM", () => process.exit(143))
  process.once("SIGINT", () => process.exit(130))

  const stdoutFd = openSync(manifest.stdoutPath, "w")
  const stderrFd = openSync(manifest.stderrPath, "w")
  const bootstrap = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child-bootstrap", runDir], {
    env: process.env,
    detached: true,
    stdio: ["pipe", stdoutFd, stderrFd, "pipe"],
    windowsHide: true,
  })
  childPid = bootstrap.pid
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

  if (bootstrap.pid === undefined) throw new Error("child bootstrap did not receive a pid")
  const childProcessStart = await getSupervisorProcessStart(bootstrap.pid)
  // The pipe gate keeps the child idle until its lease ownership and ledger are durable.
  await lease.retainFor(bootstrap.pid, childProcessStart)
  await updateRunLedger(ledgerPath, {
    childPid: bootstrap.pid,
    childProcessStart,
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
  maybeKillAt("after-child-exit")

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
  await lease.release()
  await publishRunOutcome(runDir, manifest, outcome)
  await unlinkRunArtifact(launchPath)
  process.exit(0)
}
const args = process.argv.slice(2)
try {
  if (args[0] === "--memory-hook") {
    process.exitCode = runMemoryHook(args.slice(1), process.cwd())
  } else if (args[0] === "--child-bootstrap") {
    if (args[1] === undefined) throw new TypeError("run directory is required")
    await runChildBootstrap(args[1])
  } else {
    if (args[0] === undefined) throw new TypeError("run directory is required")
    await runSupervisor(args[0])
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exit(1)
}
