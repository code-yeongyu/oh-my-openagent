import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createLockRecord, LockContentionError, withLock } from "@oh-my-opencode/memory-core"
import { createMemoryRunSupervisorIc8Harness, IC8_PLATFORMS, IC8_WAIT_MS } from "./memory-run-supervisor-ic8-harness"
import { terminateProcessGroup } from "./memory-run-supervisor-ic8-process-groups"
import { withRunTerminalGate } from "./run-terminal-gate"
import { waitForFilesystemState } from "./supervisor-test-signals"

setDefaultTimeout(IC8_WAIT_MS)
const harness = createMemoryRunSupervisorIc8Harness()
const {
  advanceClock,
  cleanup,
  cleanupExitResources,
  cleanupRunResources,
  launchSupervisor,
  makeRun,
  processGroupIsAlive,
  resourceCounts,
  trackProcessGroup,
  untrackProcessGroup,
  waitBounded,
  waitForExit,
  waitForPath,
} = harness

afterEach(async () => harness.cleanup())

describe("memory run supervisor IC-8 containment", () => {
  test("#given a guard stalled before ready #then the startup deadline contains it and frees the slot", async () => {
    if (process.platform === "win32") return
    const { runDir, clockPath, childExited, exitSocketAccepted } = await makeRun("stubborn")
    await writeFile(join(runDir, "stall-before-ready"), "")
    const signalLog = join(runDir, "external-signals.jsonl")
    await writeFile(signalLog, "")
    const supervisor = launchSupervisor(
      runDir,
      clockPath,
      "posix",
      join(import.meta.dir, "__fixtures__/supervisor-signal-spy.ts"),
    )
    const exit = waitForExit(supervisor)
    const guardSocket = await exitSocketAccepted
    await waitForPath(join(runDir, "guard.pid"))
    const guardPid = Number(await readFile(join(runDir, "guard.pid"), "utf8"))
    try {
      await advanceClock(clockPath, 3_000)
      const outcomePath = join(runDir, "outcome.json")
      await waitForPath(outcomePath, 3_000).catch((cause: unknown) => {
        throw new Error(
          `startup outcome missing; guard socket open=${!guardSocket.destroyed}, slot held=${existsSync(slotPath(runDir))}`,
          { cause },
        )
      })
      await waitBounded(childExited, 3_000, "stalled guard to exit at the startup deadline")
      expect(await exit).toEqual({ code: 0, signal: null })
      expect(JSON.parse(await readFile(outcomePath, "utf8"))).toMatchObject({
        timedOut: true,
        childExit: { code: null, signal: "SIGKILL" },
      })
      expect(existsSync(join(runDir, "child-started.json"))).toBe(false)
      expect(existsSync(slotPath(runDir))).toBe(false)
      expect(await readFile(signalLog, "utf8")).toBe("")
    } finally {
      if (!guardSocket.destroyed) killFixturePid(guardPid)
      await exit
    }
  })

  test("#given bootstrap close with a live guard and model #then publication and admission wait for containment", async () => {
    if (process.platform === "win32") return
    const { runDir, clockPath, childExited, exitSocketAccepted } = await makeRun("stubborn")
    const supervisor = launchSupervisor(
      runDir,
      clockPath,
      "posix",
      join(import.meta.dir, "__fixtures__/supervisor-signal-spy.ts"),
    )
    const exit = waitForExit(supervisor)
    const modelSocket = await exitSocketAccepted
    const guard = Number(await readFile(join(runDir, "guard.pid"), "utf8"))
    const { childPid } = JSON.parse(await readFile(join(runDir, "ledger.json"), "utf8"))
    process.kill(guard, "SIGSTOP")
    try {
      killFixturePid(childPid)
      await waitForPath(join(runDir, "bootstrap-closed"))
      // A file merely remaining on disk is not enough: an actual contender may reap
      // the dead bootstrap's slot even before the supervisor explicitly releases it.
      const admitted = await slotAdmitsContender(runDir)
      if (admitted) await waitForPath(join(runDir, "outcome.json"))
      expect({
        admitted,
        published: existsSync(join(runDir, "outcome.json")),
        modelAlive: !modelSocket.destroyed,
      }).toEqual({ admitted: false, published: false, modelAlive: true })
    } finally {
      process.kill(guard, "SIGCONT")
      await waitBounded(childExited, 3_000, "guard to contain the model after bootstrap close")
      await exit
    }
    expect(await exit).toEqual({ code: 0, signal: null })
    expect(JSON.parse(await readFile(join(runDir, "outcome.json"), "utf8"))).toMatchObject({
      timedOut: false,
      childExit: { code: null, signal: "SIGKILL" },
    })
    expect(existsSync(slotPath(runDir))).toBe(false)
  })

  test("#given a reader dead before EOF #then stale reclaim waits for the last group member", async () => {
    if (process.platform === "win32") return
    const { runDir, clockPath, childExited, exitSocketAccepted } = await makeRun("stubborn")
    const supervisor = launchSupervisor(
      runDir,
      clockPath,
      "posix",
      join(import.meta.dir, "__fixtures__/supervisor-signal-spy.ts"),
    )
    const exit = waitForExit(supervisor)
    const modelSocket = await exitSocketAccepted
    const guard = Number(await readFile(join(runDir, "guard.pid"), "utf8"))
    const reader = Number(await readFile(join(runDir, "reader.pid"), "utf8"))
    const { childPid } = JSON.parse(await readFile(join(runDir, "ledger.json"), "utf8"))
    process.kill(guard, "SIGSTOP")
    try {
      killFixturePid(childPid)
      await waitForPath(join(runDir, "bootstrap-closed"))
      killFixturePid(reader)
      // The reader, supervisor and group leader are all gone; the socket peer isn't.
      expect(await exit).toEqual({ code: 1, signal: null })
      expect({
        admitted: await slotAdmitsContender(runDir),
        modelAlive: !modelSocket.destroyed,
        published: existsSync(join(runDir, "outcome.json")),
      }).toEqual({ admitted: false, modelAlive: true, published: false })
    } finally {
      process.kill(guard, "SIGCONT")
      await waitBounded(childExited, 3_000, "guard to contain the surviving owned model")
      await exit
    }
    expect(await slotAdmitsContender(runDir, 3_000)).toBe(true)
  })

  test("#given an owned child before deadline #when the supervisor receives TERM #then its exit handler contains the group", async () => {
    if (process.platform === "win32") return
    const { runDir, clockPath, childExited, exitSocketAccepted } = await makeRun("stubborn")
    const supervisor = launchSupervisor(runDir, clockPath, "posix")
    const exit = waitForExit(supervisor)
    await exitSocketAccepted
    supervisor.kill("SIGTERM")
    expect(await exit).toEqual({ code: 143, signal: null })
    await waitBounded(childExited, 3_000, "owned socket close on supervisor exit")
  })

  test("#given a timely nonzero model exit without pipe status #then the durable code wins over the bootstrap's zero", async () => {
    if (process.platform === "win32") return
    const { runDir, clockPath } = await makeRun("inspect")
    const supervisor = launchSupervisor(
      runDir,
      clockPath,
      "posix",
      join(import.meta.dir, "__fixtures__/supervisor-signal-spy.ts"),
    )
    expect(await waitForExit(supervisor)).toEqual({ code: 0, signal: null })
    expect(JSON.parse(await readFile(join(runDir, "outcome.json"), "utf8"))).toMatchObject({
      timedOut: false,
      childExit: { code: 23, signal: null },
    })
    expect(existsSync(slotPath(runDir))).toBe(false)
  })

  for (const duringGrace of [false, true]) {
    test(`#given bootstrap loss ${duringGrace ? "during grace" : "before deadline"} without pipe status #then containment does not wait for or signal at a later deadline`, async () => {
      if (process.platform === "win32") return
      const { runDir, clockPath, childExited, exitSocketAccepted } = await makeRun(
        duringGrace ? "with-stubborn-grandchild" : "stubborn",
      )
      const supervisor = launchSupervisor(
        runDir,
        clockPath,
        "posix",
        join(import.meta.dir, "__fixtures__/supervisor-signal-spy.ts"),
      )
      const exit = waitForExit(supervisor)
      await exitSocketAccepted
      await waitForPath(join(runDir, "child-started.json"))
      const { childPid } = JSON.parse(await readFile(join(runDir, "ledger.json"), "utf8"))
      const peer = JSON.parse(
        await readFile(join(runDir, duringGrace ? "grandchild.json" : "child-started.json"), "utf8"),
      )
      if (duringGrace) {
        await advanceClock(clockPath, 2_000)
        const record = join(runDir, "child-exit.json")
        await waitForPath(record)
        expect(JSON.parse(await readFile(record, "utf8"))).toMatchObject({ code: 0, signal: null, timedOut: true })
      }
      const spyLog = join(runDir, "external-signals.jsonl")
      await writeFile(spyLog, "")
      try {
        const containedBeforeDeadline = await withRunTerminalGate(runDir, "run-ic8", async () => {
          killFixturePid(childPid)
          const contained = await waitBounded(
            childExited,
            3_000,
            "owned child to close after bootstrap loss with clock frozen",
          ).then(
            () => true,
            () => false,
          )
          // Keep the supervisor alive in publication while crossing BOTH pending instants.
          if (contained) await waitForPath(join(runDir, "publishing.json"))
          await advanceClock(clockPath, 3_000)
          return contained
        })
        expect(await exit).toEqual({ code: 0, signal: null })
        expect(await readFile(spyLog, "utf8")).toBe("")
        expect(containedBeforeDeadline).toBe(true)
        const outcome = JSON.parse(await readFile(join(runDir, "outcome.json"), "utf8"))
        expect(outcome).toMatchObject({
          timedOut: duringGrace,
          childExit: duringGrace ? { code: 0, signal: null } : { code: null, signal: "SIGKILL" },
        })
      } finally {
        // On RED the spy swallows the stale group signals, so clean up only our socket peer.
        if (!(await exitSocketAccepted).destroyed) {
          killFixturePid(peer.pid)
          await childExited
        }
      }
    })
  }

  test("#given a connected model child #when the supervisor is killed and test cleanup runs #then cleanup terminates the child group and releases the socket", async () => {
    // given
    const { runDir, clockPath, childExited, exitSocketAccepted } = await makeRun("graceful")
    const supervisor = launchSupervisor(runDir, clockPath, "posix")
    const exit = waitForExit(supervisor)
    await waitForPath(join(runDir, "child-started.json"))
    await exitSocketAccepted
    const ledger = JSON.parse(await readFile(join(runDir, "ledger.json"), "utf8")) as { readonly childPid: number }
    expect(processGroupIsAlive(ledger.childPid)).toBe(true)

    // when
    supervisor.kill("SIGKILL")
    await exit
    await cleanupRunResources()
    await childExited

    // then
    expect(processGroupIsAlive(ledger.childPid)).toBe(false)
    expect(resourceCounts()).toEqual({
      exitServers: 0,
      acceptedSockets: 0,
      childExitTimeouts: 0,
    })
  }, 10_000)

  test("#given an unconnected exit server #when test cleanup runs #then the listener and timeout are released", async () => {
    // given
    const { childExited, exitSocketAccepted } = await makeRun("graceful")
    expect(resourceCounts()).toEqual({
      exitServers: 1,
      acceptedSockets: 0,
      childExitTimeouts: 1,
    })

    // when
    await cleanupExitResources()

    // then
    expect(resourceCounts()).toEqual({
      exitServers: 0,
      acceptedSockets: 0,
      childExitTimeouts: 0,
    })
    expect(await settlementState(exitSocketAccepted)).toBe("rejected")
    expect(await settlementState(childExited)).toBe("rejected")
  })

  test("#given a missing run ledger #when cleanup reports the ledger error #then sockets and the run root are still removed", async () => {
    // given
    const { runDir } = await makeRun("graceful")
    await rm(join(runDir, "ledger.json"))

    // when
    const result = cleanup()

    // then
    await expect(result).rejects.toThrow("ledger.json")
    expect(resourceCounts()).toEqual({
      exitServers: 0,
      acceptedSockets: 0,
      childExitTimeouts: 0,
    })
    expect(existsSync(runDir)).toBe(false)
  })

  test("#given taskkill returns nonzero #when a Windows process group is terminated #then cleanup fails closed", async () => {
    await expect(
      terminateProcessGroup(123, {
        platform: "win32",
        runTaskkill: async () => ({ status: 1 }),
        killGroup: () => {},
        probeGroup: () => {},
      }),
    ).rejects.toThrow("taskkill failed with exit code 1")
  })

  test("#given injected Windows and a child that exits during grace #when the hard deadline arrives #then the deadline tree-kill runs and the supervisor's forced kill stays unused", async () => {
    // given
    const { runDir, clockPath, childExited } = await makeRun("graceful")
    const supervisor = launchSupervisor(runDir, clockPath, "win32")
    const exit = waitForExit(supervisor)
    await waitForPath(join(runDir, "child-started.json"))

    // when
    await advanceClock(clockPath, 2_000)
    await childExited
    const result = await exit
    const outcome = JSON.parse(await readFile(join(runDir, "outcome.json"), "utf8")) as {
      readonly timedOut: boolean
      readonly childExit: { readonly code: number | null; readonly signal: string | null }
    }
    const invocationPath = join(runDir, "taskkill-invocation.json")
    await waitForPath(invocationPath)
    const invocationBeforeGrace = JSON.parse(await readFile(invocationPath, "utf8")) as { readonly args: string[] }
    const invocationMtimeBeforeGrace = (await stat(invocationPath)).mtimeMs
    await advanceClock(clockPath, 3_000)

    // then: the deadline tree-kill terminated the model; no second, forced grace kill follows.
    expect(result).toEqual({ code: 0, signal: null })
    expect(outcome.timedOut).toBe(true)
    // Real Windows ends the killed model with exit code 1; elsewhere the taskkill fixture SIGKILLs it.
    if (process.platform === "win32") expect(outcome.childExit).toEqual({ code: 1, signal: null })
    else expect(outcome.childExit).toEqual({ code: null, signal: "SIGKILL" })
    expect(invocationBeforeGrace.args.slice(-4)).toEqual(["/pid", expect.any(String), "/T", "/F"])
    expect((await stat(invocationPath)).mtimeMs).toBe(invocationMtimeBeforeGrace)
  }, 60_000)

  for (const enforcer of ["bootstrap", "supervisor"] as const) {
    test(`#given a POSIX grandchild ignoring TERM #when ${enforcer} acts alone #then the socket closes`, async () => {
      if (process.platform === "win32") return
      // given: the grandchild alone owns this socket and connects after installing its SIGTERM handler.
      const { runDir, clockPath, childExited, exitSocketAccepted } = await makeRun("with-stubborn-grandchild")
      const supervisor = launchSupervisor(runDir, clockPath, "posix")
      const exit = waitForExit(supervisor)
      await waitForPath(join(runDir, "child-started.json"))
      const { pid } = JSON.parse(await readFile(join(runDir, "grandchild.json"), "utf8")) as { readonly pid: number }
      const socket = await waitBounded(exitSocketAccepted, IC8_WAIT_MS, "grandchild socket connection")

      try {
        // when: leave precisely one enforcer alive when the clock reaches the grace deadline.
        if (enforcer === "bootstrap") {
          supervisor.kill("SIGKILL")
          await exit
        }
        await advanceClock(clockPath, 2_000)
        const childExitPath = join(runDir, "child-exit.json")
        await waitForPath(childExitPath)
        expect(JSON.parse(await readFile(childExitPath, "utf8"))).toMatchObject({ code: 0, timedOut: true })
        expect(socket.destroyed).toBe(false)
        if (enforcer === "supervisor") {
          const { childPid } = JSON.parse(await readFile(join(runDir, "ledger.json"), "utf8")) as {
            readonly childPid: number
          }
          killFixturePid(childPid)
        }
        await advanceClock(clockPath, 3_000)

        // then: await peer closure, not PID disappearance (the orphan may still be a zombie).
        await waitBounded(childExited, 5_000, "SIGTERM-ignoring grandchild socket close")
        if (enforcer === "supervisor") {
          expect(await exit).toEqual({ code: 0, signal: null })
          const outcome = JSON.parse(await readFile(join(runDir, "outcome.json"), "utf8"))
          expect(outcome).toMatchObject({ timedOut: true, childExit: { code: 0, signal: null } })
        }
      } finally {
        if (!socket.destroyed) {
          killFixturePid(pid)
          await waitBounded(childExited, 5_000, "grandchild socket cleanup")
        }
      }
    })
  }

  test("#given a model with a live grandchild #when the hard deadline arrives on injected Windows #then the model's whole tree is terminated", async () => {
    // Runtime regression for the parked reflection runs: child-exit recorded SIGTERM while the
    // agent's descendants kept working for another hour. Only the model CLI died before the fix.
    // The injected win32 branch and taskkill fixture run on every host, so this guards Linux and
    // macOS CI too.
    const { runDir, clockPath, childExited } = await makeRun("with-grandchild")
    const supervisor = launchSupervisor(runDir, clockPath, "win32")
    const exit = waitForExit(supervisor)
    await waitForPath(join(runDir, "child-started.json"))
    const grandchild = JSON.parse(await readFile(join(runDir, "grandchild.json"), "utf8")) as { readonly pid: number }
    trackProcessGroup(grandchild.pid)
    expect(processGroupIsAlive(grandchild.pid)).toBe(true)

    await advanceClock(clockPath, 2_000)
    await childExited
    const result = await exit

    expect(result).toEqual({ code: 0, signal: null })
    expect(processGroupIsAlive(grandchild.pid)).toBe(false)
    untrackProcessGroup(grandchild.pid)
  }, 60_000)

  for (const platform of IC8_PLATFORMS) {
    test(`#given the injected ${platform} branch #when the absolute deadline instants are advanced #then graceful and hard tree termination use those instants`, async () => {
      // given
      const { runDir, clockPath, childExited } = await makeRun("stubborn")
      const supervisor = launchSupervisor(runDir, clockPath, platform)
      const exit = waitForExit(supervisor)
      await waitForPath(join(runDir, "child-started.json"))
      expect(existsSync(join(runDir, "child-terminated.json"))).toBe(false)
      const nativeWindowsGraceWins = platform === "win32" && process.platform === "win32"

      // when
      await advanceClock(clockPath, 2_000)
      if (supervisor.pid === undefined) throw new Error("supervisor pid is required")
      if (platform === "win32") await waitForPath(join(runDir, `win32-graceful-${supervisor.pid}.json`))
      else {
        const { childPid } = JSON.parse(await readFile(join(runDir, "ledger.json"), "utf8"))
        // A TERM delivered on the supervisor's behalf, independently of the bootstrap's own timer.
        await waitForFilesystemState(
          runDir,
          async () =>
            (await readdir(runDir)).some(
              (name) => name.startsWith("posix-SIGTERM-") && name !== `posix-SIGTERM-${childPid}.json`,
            ) || undefined,
          IC8_WAIT_MS,
          "supervisor's group TERM",
        )
      }
      if (nativeWindowsGraceWins) {
        await childExited
        await waitForPath(join(runDir, "outcome.json"))
      }
      await advanceClock(clockPath, 3_000)
      await waitForPath(join(runDir, "outcome.json"))
      await Promise.all([exit, childExited])

      // then
      const outcome = JSON.parse(await readFile(join(runDir, "outcome.json"), "utf8")) as Record<string, unknown>
      expect(outcome.timedOut).toBe(true)
      // Windows terminates the model's whole tree at the deadline (taskkill /T /F), not just the CLI.
      if (platform === "win32") {
        const invocationPath = join(runDir, "taskkill-invocation.json")
        await waitForPath(invocationPath)
        const invocation = JSON.parse(await readFile(invocationPath, "utf8")) as { readonly args: string[] }
        expect(invocation.args.slice(-4)).toEqual(["/pid", expect.any(String), "/T", "/F"])
      } else {
        expect(existsSync(join(runDir, "taskkill-invocation.json"))).toBe(false)
      }
    }, 60_000)

    test(`#given the injected ${platform} branch and a released child #when the supervisor dies abruptly #then the bootstrap alone enforces the persisted deadline`, async () => {
      // given
      const { runDir, clockPath, childExited } = await makeRun("graceful")
      const supervisor = launchSupervisor(runDir, clockPath, platform)
      const exit = waitForExit(supervisor)
      await waitForPath(join(runDir, "child-started.json"))
      const ledger = JSON.parse(await readFile(join(runDir, "ledger.json"), "utf8")) as { readonly childPid: number }
      trackProcessGroup(ledger.childPid)

      // when
      supervisor.kill("SIGKILL")
      await exit
      expect(existsSync(join(runDir, "outcome.json"))).toBe(false)
      await advanceClock(clockPath, 2_000)
      await waitForPath(
        join(runDir, `${platform === "win32" ? "win32-graceful" : "posix-SIGTERM"}-${ledger.childPid}.json`),
      )
      await childExited
      if (platform === "posix") {
        await waitForPath(join(runDir, "child-exit.json"))
        await advanceClock(clockPath, 3_000)
        await waitForPath(join(runDir, `posix-SIGKILL-${ledger.childPid}.json`))
      }
      untrackProcessGroup(ledger.childPid)

      // then
      expect(existsSync(join(runDir, "outcome.json"))).toBe(false)
    }, 60_000)
  }
})

function slotPath(runDir: string): string {
  return join(runDir, "runtime", "locks", "reflection-run.slot-1.lock")
}

async function slotAdmitsContender(runDir: string, waitTimeoutMs = 0): Promise<boolean> {
  const contender = await createLockRecord("reflection-run")
  try {
    return await withLock(slotPath(runDir), contender, async () => true, { waitTimeoutMs })
  } catch (error) {
    if (error instanceof LockContentionError) return false
    throw error
  }
}

function killFixturePid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) throw new RangeError("fixture pid must be a positive integer")
  try {
    process.kill(pid, "SIGKILL")
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
  }
}

async function settlementState(signal: Promise<unknown>): Promise<"resolved" | "rejected" | "pending"> {
  let state: "resolved" | "rejected" | "pending" = "pending"
  void signal.then(
    () => {
      state = "resolved"
    },
    () => {
      state = "rejected"
    },
  )
  await Promise.resolve()
  return state
}
