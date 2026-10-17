import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { runDaemonCommand } from "../bin/lib/daemon.js"
import { hostStopBudgetMs, postDrainStopReserveMs } from "../bin/lib/daemon-stop-budget.js"

const engineStopModule = join(dirname(fileURLToPath(import.meta.resolve("@code-yeongyu/senpi"))), "modes/rpc/host-ensure-stop.js")
const engineIntentModule = join(dirname(engineStopModule), "host-stop-intent.js")
const engineStalledModule = join(dirname(engineStopModule), "host-stalled-evidence.js")

function stop({ releaseAt = Infinity, timeout = "30", env = {}, reachable = true } = {}) {
  let clock = 0
  let pauses = 0
  let output = ""
  const live = {
    socket: "/tmp/omo-stop-budget.sock", reachable, pid: reachable ? 4242 : null,
    generations: [{ pid: 4242, alive: true }], claims_live: 0,
  }
  const engine = {
    run(args) {
      if (args.includes("--all")) return { exitCode: 0, stdout: JSON.stringify({ endpoints: [live] }) }
      if (args[1] === "stop") return { exitCode: 0, stdout: JSON.stringify({ action: "stopped" }) }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          ...live, generations: [{ pid: 4242, alive: clock < releaseAt }],
        }),
      }
    },
  }
  const exitCode = runDaemonCommand([
    "stop", "--all", "--wait", ...(timeout === undefined ? [] : ["--timeout", timeout]),
  ], {
    engine, pluginRoot: "/missing-plugin", agentDir: "/tmp/omo-stop-budget-agent",
    env, platform: "darwin",
    stdout: { write: (text) => { output += text } }, stderr: { write() {} },
    now: () => clock,
    pause: (ms) => { clock += ms; pauses += 1 },
  })
  return { exitCode, clock, pauses, output }
}

describe("daemon stop respects the engine shutdown budget", () => {
  // Compare the total and its parts: an engine can move time into the
  // post-drain reserve without changing its total stop budget.
  for (const value of [undefined, "120000", "900000", "1", " 120000 ", "0", "-1", "1.5", "bad"]) {
    test(`total and post-drain reserve match installed Senpi with stalled stop override ${value === undefined ? "unset" : JSON.stringify(value)}`, () => {
      const env = { ...process.env }
      delete env.SENPI_RPC_CHILD_STALLED_STOP_MAX_MS
      if (value !== undefined) env.SENPI_RPC_CHILD_STALLED_STOP_MAX_MS = value
      const engine = JSON.parse(execFileSync(process.execPath, [
        "--eval",
        `import { STOP_WAIT_BUDGET_MS, DEFAULT_STOP_TIMEOUT_MS, SIGKILL_GRACE_MS } from ${JSON.stringify(pathToFileURL(engineStopModule).href)};
import { CHILD_STOP_TIMEOUT_MS, CHILD_KILL_EXIT_TIMEOUT_MS } from ${JSON.stringify(pathToFileURL(engineIntentModule).href)};
import { childStalledStopMaxMs } from ${JSON.stringify(pathToFileURL(engineStalledModule).href)};
console.log(JSON.stringify({
  budget: STOP_WAIT_BUDGET_MS, defaultStop: DEFAULT_STOP_TIMEOUT_MS, sigkillGrace: SIGKILL_GRACE_MS,
  childStop: CHILD_STOP_TIMEOUT_MS, childKillExit: CHILD_KILL_EXIT_TIMEOUT_MS, stalled: childStalledStopMaxMs(),
}))`,
      ], { env, cwd: tmpdir(), encoding: "utf8", timeout: 15_000 }))
      expect(Number.isFinite(engine.budget)).toBe(true)
      expect(hostStopBudgetMs(env)).toBe(engine.budget)
      expect(postDrainStopReserveMs()).toBe(
        engine.defaultStop - Math.max(engine.childStop, engine.stalled)
          - engine.childKillExit + engine.sigkillGrace,
      )
    })
  }

  test("a short explicit timeout cannot cut a valid slow stop short", () => {
    const result = stop({ releaseAt: 90_000 })
    expect(result.exitCode).toBe(0)
    expect(result.clock).toBe(90_000)
    expect(result.output).toContain("drained")
  })

  test("an immediately drained host returns without pausing", () => {
    expect(stop({ releaseAt: 0 })).toMatchObject({ exitCode: 0, clock: 0, pauses: 0 })
  })

  test("a truly stuck host still times out with its pid", () => {
    const result = stop()
    expect(result.exitCode).toBe(3)
    expect(result.clock).toBeGreaterThanOrEqual(97_000)
    expect(result.clock).toBeLessThan(98_000)
    expect(result.output).toContain("TIMEOUT: still live (pid 4242")
  })

  test("a longer caller timeout remains honored", () => {
    expect(stop({ releaseAt: 110_000, timeout: "120" })).toMatchObject({
      exitCode: 0, clock: 110_000,
    })
  })

  test("an unreachable endpoint still names its live generation pid", () => {
    const result = stop({ reachable: false })
    expect(result.exitCode).toBe(3)
    expect(result.output).toContain("TIMEOUT: still live (pid 4242")
  })

  test("the stalled-child environment override also raises the minimum wait", () => {
    expect(stop({
      releaseAt: 150_000, env: { SENPI_RPC_CHILD_STALLED_STOP_MAX_MS: "120000" },
    })).toMatchObject({ exitCode: 0, clock: 150_000 })
  })
})
