import { expect, spyOn, test } from "bun:test"
import { once } from "node:events"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import {
  COMPUTER_USE_DOCTOR_TIMEOUT_MS,
  launchEngineBinary,
  probeComputerUseEngine,
  type EngineLauncher,
  type EngineProbeResult,
} from "./engine-probe"

test.skipIf(process.platform === "win32")(
  "#given an engine descendant retaining pipes #when the deadline expires #then the probe returns and the descendant is gone",
  async () => {
    // given: time is the contract under test; no synthetic child events or pipe mocks.
    const root = mkdtempSync(join(tmpdir(), "omo-probe-descendant-"))
    const engine = join(root, "engine")
    writeFileSync(engine, `#!${process.execPath}
import { spawn } from "node:child_process";
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: ["ignore", "inherit", "inherit"]
});
descendant.on("spawn", () => process.stderr.write(String(descendant.pid) + "\\n"));
process.stdin.resume();
`)
    chmodSync(engine, 0o755)
    let descendant = 0
    let child: ReturnType<EngineLauncher> | undefined
    let exited: Promise<unknown> | undefined
    const launch: EngineLauncher = (...args) => {
      child = launchEngineBinary(...args)
      exited = once(child, "exit")
      createInterface({ input: child.stderr }).once("line", (line) => { descendant = Number(line) })
      return child
    }
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const started = performance.now()
    const probe = probeComputerUseEngine(engine, {}, COMPUTER_USE_DOCTOR_TIMEOUT_MS, launch)
    try {
      // when: the real five-second deadline must not await inherited pipe EOF.
      const result = await Promise.race([
        probe,
        new Promise<EngineProbeResult | null>((resolve) => {
          watchdog = setTimeout(() => resolve(null), COMPUTER_USE_DOCTOR_TIMEOUT_MS + 1_000)
        }),
      ])
      // then
      expect(descendant).toBeGreaterThan(0)
      expect(result).not.toBeNull()
      expect(result).toMatchObject({ ok: false, code: "timeout" })
      expect(performance.now() - started).toBeLessThan(COMPUTER_USE_DOCTOR_TIMEOUT_MS + 1_000)
      await exited
      // Reaping is asynchronous: yield without sleeping within the cleanup deadline.
      while (performance.now() - started < COMPUTER_USE_DOCTOR_TIMEOUT_MS + 1_000) {
        try {
          process.kill(descendant, 0)
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
          console.log("PROBE_TIMEOUT_DESCENDANT_GONE", Math.round(performance.now() - started))
          return
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      throw new Error(`probe returned but descendant ${descendant} survived its deadline`)
    } finally {
      clearTimeout(watchdog)
      for (const pid of [descendant, child?.pid]) {
        if (!pid) continue
        try {
          process.kill(pid, "SIGKILL")
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
        }
      }
      await exited
      await probe
      rmSync(root, { recursive: true, force: true })
    }
  },
  10_000,
)

test.skipIf(process.platform === "win32")(
  "#given a probe group that macOS reports as EPERM (exited, not reaped) #when the deadline expires #then the probe reports a timeout instead of throwing",
  async () => {
    // given: an engine that never replies, and a group kill that fails the way macOS does for an unreaped group.
    const root = mkdtempSync(join(tmpdir(), "omo-probe-eperm-"))
    const engine = join(root, "engine")
    writeFileSync(engine, `#!${process.execPath}\nprocess.stdin.resume();\n`)
    chmodSync(engine, 0o755)
    let child: ReturnType<EngineLauncher> | undefined
    let exited: Promise<unknown> | undefined
    const launch: EngineLauncher = (...args) => {
      child = launchEngineBinary(...args)
      exited = once(child, "exit")
      return child
    }
    const originalKill = process.kill.bind(process)
    let groupKillAttempts = 0
    const kill = spyOn(process, "kill").mockImplementation((pid: number, signal?: string | number) => {
      if (pid >= 0) return originalKill(pid, signal)
      groupKillAttempts += 1
      originalKill(pid, signal)
      throw Object.assign(new Error("kill() failed: EPERM: Operation not permitted"), { code: "EPERM" })
    })
    const uncaught: unknown[] = []
    const onUncaught = (error: unknown) => { uncaught.push(error) }
    process.on("uncaughtException", onUncaught)
    try {
      // when
      const result = await probeComputerUseEngine(engine, {}, 200, launch)
      await exited

      // then
      expect(result).toMatchObject({ ok: false, code: "timeout" })
      expect(groupKillAttempts).toBe(1)
      expect(uncaught).toEqual([])
    } finally {
      process.off("uncaughtException", onUncaught)
      kill.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  },
  10_000,
)
