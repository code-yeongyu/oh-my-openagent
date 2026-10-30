import { describe, expect, onTestFinished, spyOn, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hostStopBudgetMs, postDrainStopReserveMs } from "../../packages/omo-native/bin/lib/daemon-stop-budget.js"
import { smokeStopCommand, stopSmokeHosts, waitForSmokeSupervisors } from "./omo-native-eval-smoke-stop.mjs"

describe("packaged eval smoke shutdown", () => {
  function observer(exits = {}) {
    let clock = 100_000
    const started = clock
    const waits = []
    return {
      waits,
      elapsed: () => clock - started,
      now: () => clock,
      isAlive: (pid) => clock - started < (exits[pid] ?? Infinity),
      pause: async (ms) => {
        // An uncapped implementation fails deterministically rather than hanging.
        waits.push(ms)
        expect(ms).toBeGreaterThan(0)
        expect(clock - started + ms).toBeLessThanOrEqual(postDrainStopReserveMs())
        clock += ms
      },
    }
  }

  test("observed supervisors share one capped post-drain reserve", async () => {
    const clock = observer()
    const failure = await waitForSmokeSupervisors([{ pid: 4242 }, { pid: 4243 }], {}, clock)
      .catch((error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toContain(`reserve ${postDrainStopReserveMs()} ms`)
    expect(clock.elapsed()).toBe(postDrainStopReserveMs())
    expect(clock.waits.reduce((sum, ms) => sum + ms, 0)).toBe(postDrainStopReserveMs())
  })

  test("a supervisor that never exits fails with pid and survival time", async () => {
    const clock = observer()
    const failure = await waitForSmokeSupervisors(
      [{ pid: 4242, command: "engine --internal-rpc-host-supervisor" }], {}, clock,
    ).catch((error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toContain("pid 4242")
    expect(failure.message).toContain(`survived ${postDrainStopReserveMs()} ms after drain`)
    expect(failure.message).toContain("--internal-rpc-host-supervisor")
  })

  test("a late supervisor exit cannot reset the shared deadline", async () => {
    const clock = observer({ 4242: 6_900 })
    const failure = await waitForSmokeSupervisors([{ pid: 4242 }, { pid: 4243 }], {}, clock)
      .catch((error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toContain("pid 4243")
    expect(failure.message).not.toContain("pid 4242")
    expect(failure.message).toContain(`survived ${postDrainStopReserveMs()} ms after drain`)
    expect(clock.elapsed()).toBe(postDrainStopReserveMs())
  })

  test("supervisors exiting inside the reserve pass as soon as observed", async () => {
    const clock = observer({ 4242: 100, 4243: 150 })
    await waitForSmokeSupervisors([{ pid: 4242 }, { pid: 4243 }], {}, clock)
    expect(clock.elapsed()).toBeGreaterThanOrEqual(150)
    expect(clock.elapsed()).toBeLessThan(postDrainStopReserveMs())
  })

  test("an already exited supervisor needs no wait", async () => {
    const clock = observer({ 4242: 0 })
    await waitForSmokeSupervisors([{ pid: 4242 }], {}, clock)
    expect(clock.waits).toEqual([])
  })

  test("permission denied liveness remains alive for the bounded leak report", async () => {
    const kill = spyOn(process, "kill").mockImplementation((pid, signal) => {
      expect(pid).toBe(4242)
      expect(signal).toBe(0)
      throw Object.assign(new Error("not permitted"), { code: "EPERM" })
    })
    onTestFinished(() => kill.mockRestore())
    const clock = observer()
    const failure = await waitForSmokeSupervisors([{ pid: 4242 }], {}, {
      now: clock.now, pause: clock.pause,
    }).catch((error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toContain(`pid 4242 survived ${postDrainStopReserveMs()} ms after drain`)
    expect(clock.elapsed()).toBe(postDrainStopReserveMs())
  })

  // Container contract: under a PID 1 that never reaps (node in a bare `docker run`), an exited
  // supervisor stays a zombie that still answers kill(pid, 0); it has exited and is not a leak.
  describe("a supervisor that answers kill(pid, 0)", () => {
    function probed(stat) {
      const kill = spyOn(process, "kill").mockImplementation(() => true)
      onTestFinished(() => kill.mockRestore())
      const clock = observer()
      const readProcStat = (pid) => {
        expect(pid).toBe(4242)
        if (stat instanceof Error) throw stat
        return stat
      }
      return { clock, run: () => waitForSmokeSupervisors([{ pid: 4242 }], {}, { now: clock.now, pause: clock.pause, readProcStat }) }
    }

    test("counts as exited when /proc reports it as a zombie", async () => {
      const { clock, run } = probed("4242 (omo) Zs 1 4242 4242 0 -1 4227332 0 0 0 0\n")
      await run()
      expect(clock.waits).toEqual([])
    })

    test("reads the state after the last parenthesis of a command name that contains one", async () => {
      const { clock, run } = probed("4242 (omo (x) R) Z 1 4242 4242 0 -1\n")
      await run()
      expect(clock.waits).toEqual([])
    })

    test.each([
      ["is still running", "4242 (omo) S 1 4242 4242 0 -1 4227328 0 0 0 0\n"],
      ["has no /proc entry to read", Object.assign(new Error("no such file"), { code: "ENOENT" })],
    ])("is reported as a leak when it %s", async (_case, stat) => {
      const { clock, run } = probed(stat)
      const failure = await run().catch((error) => error)
      expect(failure).toBeInstanceOf(Error)
      expect(failure.message).toContain(`pid 4242 survived ${postDrainStopReserveMs()} ms after drain`)
      expect(clock.elapsed()).toBe(postDrainStopReserveMs())
    })
  })

  test.each([{}, { SENPI_RPC_CHILD_STALLED_STOP_MAX_MS: "120000" }])(
    "the command and outer deadline cover the same engine budget for each endpoint",
    (env) => {
      const budget = hostStopBudgetMs(env)
      for (const count of [0, 1, 3]) {
        const command = smokeStopCommand(env, count)
        expect(command.args.slice(0, 5)).toEqual(["daemon", "stop", "--all", "--wait", "--timeout"])
        expect(Number(command.args[5]) * 1_000).toBeGreaterThanOrEqual(budget)
        expect(command.timeout).toBeGreaterThan(Math.max(1, count) * budget * 2)
      }
    },
  )

  function binary(exitCode, { statusExitCode = 0, endpoints = [
    { pid: 4242, generations: [{ pid: 4243 }] },
    { pid: 9999, endpoint_kind: "tui" },
  ], clockPath } = {}) {
    const root = mkdtempSync(join(tmpdir(), "omo-smoke-stop-"))
    onTestFinished(() => rmSync(root, { recursive: true, force: true }))
    const path = join(root, "omo")
    const stopReceipt = join(root, "stop-sent")
    writeFileSync(path, `#!${process.execPath}
import { writeFileSync } from "node:fs"
const args = process.argv.slice(2)
if (args[1] === "status") {
  console.log(${JSON.stringify(JSON.stringify({ endpoints }))})
  process.exit(${statusExitCode})
} else {
  if (args.join(" ") !== "daemon stop --all --wait --timeout 97") process.exit(2)
  ${clockPath ? `writeFileSync(${JSON.stringify(clockPath)}, "200000")` : ""}
  writeFileSync(${JSON.stringify(stopReceipt)}, "")
  console.log(${JSON.stringify(exitCode === 0 ? "/tmp/test.sock: drained (1 polls)" : "/tmp/test.sock: TIMEOUT: still live (pid 4243, 0 sessions, 0 claims)")})
  process.exit(${exitCode})
}
`)
    chmodSync(path, 0o755)
    return { root, path, stopReceipt }
  }

  test.skipIf(process.platform === "win32")("an executable that drains immediately returns its shutdown receipt", async () => {
    const fixture = binary(0)
    const result = await stopSmokeHosts(fixture.path, { cwd: fixture.root, env: {} })
    expect(result.stdout).toContain("drained (1 polls)")
  })

  test.skipIf(process.platform === "win32")("drain alone does not pass a never-exiting observed supervisor", async () => {
    const fixture = binary(0)
    const clock = observer()
    let drained
    const failure = await stopSmokeHosts(fixture.path, { cwd: fixture.root, env: {} }, {
      supervisors: [{ pid: 4242 }], observer: clock,
      onDrained: (result) => { drained = result.stdout },
    }).catch((error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toContain("pid 4242")
    expect(failure.message).toContain(`survived ${postDrainStopReserveMs()} ms after drain`)
    expect(drained).toContain("/tmp/test.sock: drained")
  })

  test.skipIf(process.platform === "win32")("drain waits for observed exit before returning its receipt", async () => {
    const fixture = binary(0)
    const clock = observer({ 4242: 150 })
    const result = await stopSmokeHosts(fixture.path, { cwd: fixture.root, env: {} }, {
      supervisors: [{ pid: 4242 }], observer: clock,
    })
    expect(result.stdout).toContain("drained")
    expect(clock.elapsed()).toBeGreaterThanOrEqual(150)
    expect(clock.elapsed()).toBeLessThan(postDrainStopReserveMs())
  })

  test.skipIf(process.platform === "win32")("clock starts at drain, not command or observer start", async () => {
    const root = mkdtempSync(join(tmpdir(), "omo-smoke-clock-"))
    onTestFinished(() => rmSync(root, { recursive: true, force: true }))
    const clockPath = join(root, "clock")
    writeFileSync(clockPath, "100000")
    const fixture = binary(0, { clockPath })
    const now = () => Number(readFileSync(clockPath, "utf8"))
    let drainedAt
    const receiptWorkMs = 6_950
    const waits = []
    const failure = await stopSmokeHosts(fixture.path, { cwd: fixture.root, env: {} }, {
      supervisors: [{ pid: 4242 }],
      observer: {
        now,
        isAlive: () => true,
        pause: async (ms) => {
          waits.push(ms)
          expect(ms).toBeGreaterThan(0)
          expect(now() + ms).toBeLessThanOrEqual(drainedAt + postDrainStopReserveMs())
          writeFileSync(clockPath, String(now() + ms))
        },
      },
      onDrained() {
        // The executable advanced the fake clock during stop. Receipt work
        // consumes reserve too; neither interval depends on real timing.
        drainedAt = now()
        writeFileSync(clockPath, String(drainedAt + receiptWorkMs))
      },
    }).catch((error) => error)
    expect(drainedAt).toBe(200_000)
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toContain(`pid 4242 survived ${postDrainStopReserveMs()} ms after drain`)
    expect(now() - drainedAt).toBe(postDrainStopReserveMs())
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBe(postDrainStopReserveMs() - receiptWorkMs)
  })

  test.skipIf(process.platform === "win32")("a failed executable keeps ownership pids and the timeout output", async () => {
    const fixture = binary(3)
    const failure = await stopSmokeHosts(fixture.path, { cwd: fixture.root, env: {} }).catch((error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toContain("daemon stop failed (pid 4243, 4242)")
    expect(failure.message).toContain("TIMEOUT: still live (pid 4243")
  })

  test.skipIf(process.platform === "win32")("status exit 3 with no host still sends stop and passes", async () => {
    const fixture = binary(0, { statusExitCode: 3, endpoints: [] })
    const result = await stopSmokeHosts(fixture.path, { cwd: fixture.root, env: {} })
    expect(existsSync(fixture.stopReceipt)).toBe(true)
    expect(result.stdout).toContain("drained")
  })

  test.skipIf(process.platform === "win32")("status exit 3 with a stalled host sends stop and names its pid on failure", async () => {
    const fixture = binary(3, {
      statusExitCode: 3,
      endpoints: [{ pid: null, reachable: false, generations: [{ pid: 4243, alive: true }] }],
    })
    const failure = await stopSmokeHosts(fixture.path, { cwd: fixture.root, env: {} }).catch((error) => error)
    expect(existsSync(fixture.stopReceipt)).toBe(true)
    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toContain("daemon stop failed (pid 4243)")
    expect(failure.message).toContain("TIMEOUT: still live (pid 4243")
  })
})
