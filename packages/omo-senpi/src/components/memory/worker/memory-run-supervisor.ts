#!/usr/bin/env node
import { spawn } from "node:child_process"
import { once } from "node:events"
import { closeSync, openSync } from "@oh-my-opencode/memory-core/fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { runMemoryHook } from "@oh-my-opencode/memory-core/memory-hook"
import type { RunChildExit, RunLaunchManifest, RunOutcome } from "./run-artifacts"
import type { SupervisorChildExit } from "./supervisor-process-identity"

async function runSupervisor(runDir: string): Promise<void> {
  const { maybeKillAt } = await import("@oh-my-opencode/memory-core")
  const { unlinkRunArtifact, updateRunLedger } = await import("./run-artifacts")
  const {
    getSupervisorProcessStart,
    getSupervisorRuntimePlatform,
    parseSupervisorChildExit,
    readSupervisorClockNow,
    recordSupervisorGracefulDeadline,
    scheduleSupervisorDeadline,
    taskkillTree,
  } = await import("./supervisor-process-identity")
  const { publishRunOutcome } = await import("./run-outcome-publication")
  const { admitSupervisor } = await import("./supervisor-admission")
  const launchPath = join(runDir, "launch.json")
  const ledgerPath = join(runDir, "ledger.json")
  const { manifest, lease } = await admitSupervisor(runDir)
  const platform = getSupervisorRuntimePlatform()
  let childPid: number | undefined
  let requestGroupSignal: ((signal: NodeJS.Signals) => void) | undefined
  const containChild = () => {
    try {
      if (childPid !== undefined) {
        if (platform === "win32") taskkillTree(childPid, true)
        else requestGroupSignal?.("SIGKILL")
      }
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
  const witness =
    platform === "posix" && process.platform !== "win32"
      ? await startContainmentWitness(() => requestGroupSignal?.("SIGKILL"))
      : undefined
  const bootstrap = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child-bootstrap", runDir], {
    env: process.env,
    detached: true,
    stdio: ["pipe", stdoutFd, stderrFd, "pipe", platform === "posix" ? "pipe" : "ignore", witness?.input ?? "ignore"],
    windowsHide: true,
  })
  witness?.input.destroy()
  childPid = bootstrap.pid
  const commands = bootstrap.stdio[4]
  if (commands && "write" in commands) {
    commands.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE" && error.code !== "ECONNRESET") throw error
    })
    requestGroupSignal = (signal) => {
      if (commands.writable) commands.write(`${signal}\n`)
    }
  }
  let cancelTerm = () => {}
  let cancelKill = () => {}
  let bootstrapExited = false
  bootstrap.once("exit", () => {
    bootstrapExited = true
    if (platform !== "posix") return
    cancelTerm()
    cancelKill()
    requestGroupSignal = undefined
  })
  const closed = new Promise<SupervisorChildExit>((resolve, reject) => {
    bootstrap.once("error", reject)
    bootstrap.once("close", (code, signal) => resolve({ code, signal }))
  })
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

  const bootstrapPid = bootstrap.pid
  if (bootstrapPid === undefined) throw new Error("child bootstrap did not receive a pid")
  const childProcessStart = await getSupervisorProcessStart(bootstrapPid)
  // The pipe gate keeps the child idle until its lease ownership and ledger are durable.
  // The supervisor releases on EOF. If it dies instead, reclaim must also prove
  // the detached group empty, even if the reader and bootstrap have both died.
  if (witness) await lease.retainFor(process.pid, await getSupervisorProcessStart(process.pid), bootstrapPid)
  else await lease.retainFor(bootstrapPid, childProcessStart)
  await updateRunLedger(ledgerPath, {
    childPid: bootstrapPid,
    childProcessStart,
  })
  bootstrap.stdin?.end("1\n")

  let timedOut = false
  const { promise: hardKillFinished, resolve: finishHardKill } = Promise.withResolvers<undefined>()
  if (!bootstrapExited) {
    cancelTerm = scheduleSupervisorDeadline(manifest.hardDeadlineAt, () => {
      timedOut = true
      if (platform === "win32") recordSupervisorGracefulDeadline(bootstrapPid)
      else requestGroupSignal?.("SIGTERM")
    })
    cancelKill = scheduleSupervisorDeadline(manifest.hardDeadlineAt + manifest.terminationGraceMs, () => {
      if (platform === "win32") taskkillTree(modelPid ?? bootstrapPid)
      else requestGroupSignal?.("SIGKILL")
      finishHardKill(undefined)
    })
  }
  const wrapperExit = await closed
  if (witness) await witness.waitForEof()
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
  const deadlineReached = timedOut || (Number.isFinite(clockNow) && clockNow >= manifest.hardDeadlineAt)
  // If the pipe was lost after the atomic write, keep the model's status, not the
  // bootstrap's exit code or the signal that ended the group.
  const recordedExit =
    platform === "posix" && childExit === undefined ? await readRecordedChildExit(runDir, manifest) : undefined
  const finishedAt = new Date().toISOString()
  const outcome: RunOutcome = {
    version: 1,
    runId: manifest.runId,
    attempt: manifest.attempt,
    finishedAt,
    childExit: childExit ?? recordedExit ?? wrapperExit,
    timedOut: deadlineReached,
  }
  await lease.release()
  await publishRunOutcome(runDir, manifest, outcome)
  await unlinkRunArtifact(launchPath)
  process.exit(0)
}

/** Only the detached group has writers after spawn. Reader failure requests containment,
 * but neither that request nor the reader's disappearance proves EOF. */
async function startContainmentWitness(onFailure: () => void) {
  const reader = spawn("/bin/cat", [], { detached: true, stdio: ["pipe", "ignore", "ignore"] })
  await once(reader, "spawn")
  const exit = once(reader, "exit").then(([code, signal]) => {
    if (code !== 0) onFailure()
    return { code, signal }
  })
  return {
    input: reader.stdin,
    async waitForEof() {
      const { code, signal } = await exit
      if (code !== 0) throw new Error(`containment witness exited without EOF: ${code ?? signal}`)
    },
  }
}

async function readRecordedChildExit(
  runDir: string,
  manifest: Pick<RunLaunchManifest, "runId" | "attempt">,
): Promise<SupervisorChildExit | undefined> {
  const { CHILD_EXIT_FILENAME, readRunJson } = await import("./run-artifacts")
  try {
    const exit = await readRunJson<Partial<RunChildExit> | null>(join(runDir, CHILD_EXIT_FILENAME))
    if (
      exit?.version === 1 &&
      exit.runId === manifest.runId &&
      exit.attempt === manifest.attempt &&
      (typeof exit.code === "number" || exit.code === null) &&
      (typeof exit.signal === "string" || exit.signal === null)
    ) {
      return { code: exit.code, signal: exit.signal }
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error
    }
  }
  return undefined
}

const args = process.argv.slice(2)
try {
  if (args[0] === "--memory-hook") {
    process.exitCode = runMemoryHook(args.slice(1), process.cwd())
  } else if (args[0] === "--child-bootstrap") {
    if (args[1] === undefined) throw new TypeError("run directory is required")
    const { runChildBootstrap } = await import("./supervisor-child-bootstrap")
    await runChildBootstrap(args[1], fileURLToPath(import.meta.url))
  } else if (args[0] === "--group-guard") {
    const { runGroupGuard } = await import("./supervisor-group-guard")
    runGroupGuard(Number(args[1]))
  } else {
    if (args[0] === undefined) throw new TypeError("run directory is required")
    await runSupervisor(args[0])
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exit(1)
}
