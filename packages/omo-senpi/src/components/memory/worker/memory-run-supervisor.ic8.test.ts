import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import {
  createMemoryRunSupervisorIc8Harness,
  IC8_PLATFORMS,
  IC8_WAIT_MS,
} from "./memory-run-supervisor-ic8-harness"
import { terminateProcessGroup } from "./memory-run-supervisor-ic8-process-groups"

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
  waitForExit,
  waitForPath,
} = harness

afterEach(async () => harness.cleanup())

describe("memory run supervisor IC-8 containment", () => {
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

  test("#given taskkill returns nonzero #when a Windows process group is terminated #then cleanup fails closed", () => {
    expect(() =>
      terminateProcessGroup(123, {
        platform: "win32",
        runTaskkill: () => ({ status: 1 }),
        killGroup: () => {},
        probeGroup: () => {},
      }),
    ).toThrow("taskkill failed with exit code 1")
  })

  test("#given injected Windows and a child that exits during grace #when the hard deadline arrives #then the supervisor cancels forced taskkill", async () => {
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
    await advanceClock(clockPath, 3_000)

    // then
    expect(result).toEqual({ code: 0, signal: null })
    expect(outcome.timedOut).toBe(true)
    if (process.platform === "win32") expect(outcome.childExit).toEqual({ code: null, signal: "SIGTERM" })
    else expect(outcome.childExit).toEqual({ code: 0, signal: null })
    expect(existsSync(join(runDir, "taskkill-invocation.json"))).toBe(false)
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
      await waitForPath(join(runDir, `${platform === "win32" ? "win32-graceful" : "posix-SIGTERM"}-${supervisor.pid}.json`))
      expect(existsSync(join(runDir, "taskkill-invocation.json"))).toBe(false)
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
      if (platform === "win32" && !nativeWindowsGraceWins) {
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
      await waitForPath(join(runDir, `${platform === "win32" ? "win32-graceful" : "posix-SIGTERM"}-${ledger.childPid}.json`))
      await childExited
      untrackProcessGroup(ledger.childPid)

      // then
      expect(existsSync(join(runDir, "outcome.json"))).toBe(false)
    }, 60_000)
  }
})

async function settlementState(
  signal: Promise<unknown>,
): Promise<"resolved" | "rejected" | "pending"> {
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
