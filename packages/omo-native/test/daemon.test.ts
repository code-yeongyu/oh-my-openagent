import { describe, expect, onTestFinished, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { daemonReportLines, runDaemonCommand } from "../bin/lib/daemon.js"

/**
 * `omo daemon` is a thin wrapper: every decision about who serves the socket belongs to the
 * engine's `senpi host`. These tests pin what the wrapper itself owes - which argv it builds,
 * which exit code a caller can branch on, and that it never invents its own ensure path.
 */

interface EngineCall {
  args: string[]
  env: Record<string, string>
}

function fakeEngine(result: { exitCode: number; stdout?: string; stderr?: string }) {
  const calls: EngineCall[] = []
  return {
    calls,
    run(args: string[], options: { env: Record<string, string> }) {
      calls.push({ args, env: options.env })
      return { exitCode: result.exitCode, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
    },
  }
}

function workspace(config?: Record<string, unknown>): { pluginRoot: string; agentDir: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-daemon-cli-"))
  onTestFinished(() => rmSync(root, { recursive: true, force: true }))
  const pluginRoot = join(root, "plugin")
  const agentDir = join(root, "agent")
  mkdirSync(pluginRoot, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(
    join(pluginRoot, "daemon-launch-spec.json"),
    JSON.stringify({ schemaVersion: 1, argv: ["--mode", "rpc"], env: {} }),
  )
  if (config !== undefined) writeFileSync(join(agentDir, "omo.json"), JSON.stringify(config))
  return { pluginRoot, agentDir }
}

function capture() {
  const chunks: string[] = []
  return { chunks, write: (text: string) => void chunks.push(text), text: () => chunks.join("") }
}

type WarmAnswer =
  { kind: "warm"; state: "warmed" | "already_warm" } | { kind: "unsupported" } | { kind: "refused"; code: string }

/** The thread SDK `omo daemon run` warms the daemon through after its ensure: records each warm and each dispose. */
function warmingSdk(answer: WarmAnswer = { kind: "warm", state: "warmed" }) {
  const events: string[] = []
  return {
    events,
    threadSdk: async () => ({
      sdk: {
        warmDaemon: async () => {
          events.push("warm")
          return answer
        },
        dispose: async () => {
          events.push("dispose")
        },
      },
    }),
  }
}

describe("omo daemon", () => {
  test("run delegates to the engine with the launch spec and the resolved policy", async () => {
    const { pluginRoot, agentDir } = workspace()
    const engine = fakeEngine({ exitCode: 0, stdout: JSON.stringify({ action: "start", pid: 4242 }) })
    const stdout = capture()

    const exitCode = await runDaemonCommand(["run"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout,
      stderr: capture(),
      platform: "darwin",
      threadSdk: warmingSdk().threadSdk,
    })

    expect(exitCode).toBe(0)
    expect(engine.calls).toHaveLength(1)
    expect(engine.calls[0]?.args).toEqual([
      "host",
      "ensure",
      "--json",
      "--launch-spec",
      join(pluginRoot, "daemon-launch-spec.json"),
      "--policy",
      "upgrade",
    ])
    expect(stdout.text()).toContain("daemon: start pid 4242")
  })

  test("--json prints the engine's line verbatim instead of the human summary", () => {
    const { pluginRoot, agentDir } = workspace()
    const line = JSON.stringify({ action: "reuse", pid: 77, instanceId: "abc" })
    const engine = fakeEngine({ exitCode: 0, stdout: line })
    const stdout = capture()

    runDaemonCommand(["run", "--json"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout,
      stderr: capture(),
      platform: "darwin",
      threadSdk: warmingSdk().threadSdk,
    })

    expect(stdout.text().trim()).toBe(line)
  })

  test("--no-upgrade downgrades the policy so an upgrade can never hand off", () => {
    const { pluginRoot, agentDir } = workspace()
    const engine = fakeEngine({ exitCode: 0, stdout: JSON.stringify({ action: "reuse", pid: 1 }) })

    runDaemonCommand(["run", "--no-upgrade"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout: capture(),
      stderr: capture(),
      platform: "darwin",
      threadSdk: warmingSdk().threadSdk,
    })

    expect(engine.calls[0]?.args).toContain("never")
  })

  test("omo.json task.host_engine_policy chooses the policy when no flag overrides it", () => {
    const { pluginRoot, agentDir } = workspace({ task: { host_engine_policy: "fallback" } })
    const engine = fakeEngine({ exitCode: 0, stdout: JSON.stringify({ action: "start", pid: 9 }) })

    runDaemonCommand(["run"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout: capture(),
      stderr: capture(),
      platform: "darwin",
      threadSdk: warmingSdk().threadSdk,
    })

    expect(engine.calls[0]?.args).toContain("fallback")
  })

  test("task.host_idle_exit_ms reaches the engine", () => {
    const { pluginRoot, agentDir } = workspace({ task: { host_idle_exit_ms: 900_000 } })
    const engine = fakeEngine({ exitCode: 0, stdout: JSON.stringify({ action: "start", pid: 9 }) })

    runDaemonCommand(["run"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout: capture(),
      stderr: capture(),
      platform: "darwin",
      threadSdk: warmingSdk().threadSdk,
    })

    expect(engine.calls[0]?.args).not.toContain("--idle-exit-ms")
    expect(engine.calls[0]?.env.SENPI_RPC_HOST_IDLE_EXIT_MS).toBe("900000")
  })

  test("--persistent stays an accepted wrapper-only no-op for the adopted engine", async () => {
    const { pluginRoot, agentDir } = workspace()
    const engine = fakeEngine({ exitCode: 0, stdout: JSON.stringify({ action: "start", pid: 9 }) })

    const exitCode = await runDaemonCommand(["run", "--persistent"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout: capture(),
      stderr: capture(),
      platform: "darwin",
      threadSdk: warmingSdk().threadSdk,
    })

    expect(exitCode).toBe(0)
    expect(engine.calls[0]?.args).not.toContain("--persistent")
  })

  // #13037 cold wake: a multi-session host loads omo only for an open or a warm, so `run` warms the daemon it ensured
  // and the daemon declares the delivery consumer with no session running.
  test("run warms the daemon it ensured through the thread SDK, then closes the SDK", async () => {
    const { pluginRoot, agentDir } = workspace()
    const engine = fakeEngine({ exitCode: 0, stdout: JSON.stringify({ action: "start", pid: 9 }) })
    const stderr = capture()
    const warm = warmingSdk()

    const exitCode = await runDaemonCommand(["run"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout: capture(),
      stderr,
      platform: "darwin",
      threadSdk: warm.threadSdk,
    })

    expect(exitCode).toBe(0)
    expect(warm.events).toEqual(["warm", "dispose"])
    expect(stderr.text()).toBe("")
  })

  test.each([
    ["refuses the warm", { kind: "refused", code: "host_draining" } as const, "host_draining"],
    ["has no warm", { kind: "unsupported" } as const, "the engine has no warm"],
  ])("a daemon that %s is reported and the run still exits 0", async (_what, answer, reason) => {
    const { pluginRoot, agentDir } = workspace()
    const engine = fakeEngine({ exitCode: 0, stdout: JSON.stringify({ action: "reuse", pid: 9 }) })
    const stderr = capture()

    const exitCode = await runDaemonCommand(["run"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout: capture(),
      stderr,
      platform: "darwin",
      threadSdk: warmingSdk(answer).threadSdk,
    })

    expect(exitCode).toBe(0)
    expect(stderr.text()).toContain(reason)
  })

  test("a run whose ensure the engine refused warms nothing", async () => {
    const { pluginRoot, agentDir } = workspace()
    const engine = fakeEngine({ exitCode: 3, stdout: JSON.stringify({ action: "refuse" }) })
    const warm = warmingSdk()

    const exitCode = await runDaemonCommand(["run"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout: capture(),
      stderr: capture(),
      platform: "darwin",
      threadSdk: warm.threadSdk,
    })

    expect(exitCode).toBe(3)
    expect(warm.events).toEqual([])
  })

  test("--foreground fails clearly because the adopted engine always detaches", () => {
    const { pluginRoot, agentDir } = workspace()
    const engine = fakeEngine({ exitCode: 0, stdout: JSON.stringify({ action: "start", pid: 9 }) })
    const stderr = capture()

    const exitCode = runDaemonCommand(["run", "--foreground"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout: capture(),
      stderr,
      platform: "darwin",
    })

    expect(exitCode).toBe(2)
    expect(stderr.text()).toContain("--foreground")
    expect(engine.calls).toHaveLength(0)
  })

  test("attach is no longer a subcommand: usage exit, empty stdout, engine untouched, and stderr points to adopt", () => {
    const { pluginRoot, agentDir } = workspace()
    const engine = fakeEngine({ exitCode: 0, stdout: "" })
    const stdout = capture()
    const stderr = capture()

    const exitCode = runDaemonCommand(["attach", "--model", "x"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout,
      stderr,
      platform: "darwin",
    })

    expect(exitCode).toBe(2)
    expect(stdout.text()).toBe("")
    expect(stderr.text()).toContain("unknown subcommand 'attach'")
    expect(stderr.text()).toContain("omo daemon adopt <session>")
    expect(stderr.text()).not.toContain("attach ")
    expect(engine.calls).toHaveLength(0)
  })

  test("status exits 3 and says so in prose when no daemon answers", () => {
    const { pluginRoot, agentDir } = workspace()
    const engine = fakeEngine({ exitCode: 3, stdout: "", stderr: "no host" })
    const stdout = capture()

    const exitCode = runDaemonCommand(["status"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout,
      stderr: capture(),
      platform: "darwin",
    })

    expect(exitCode).toBe(3)
    expect(stdout.text()).toContain("daemon: not running")
  })

  test("windows has no unix socket to share, so the wrapper refuses with its own code", () => {
    const { pluginRoot, agentDir } = workspace()
    const engine = fakeEngine({ exitCode: 0, stdout: "" })
    const stderr = capture()

    const exitCode = runDaemonCommand(["run"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout: capture(),
      stderr,
      platform: "win32",
    })

    expect(exitCode).toBe(4)
    expect(engine.calls).toHaveLength(0)
    expect(stderr.text()).toContain("win32")
  })

  test("doctor reports one honest win32 line without probing the engine", () => {
    const engine = fakeEngine({ exitCode: 0, stdout: "" })

    const lines = daemonReportLines({
      engine,
      pluginRoot: "/p",
      agentDir: "/a",
      env: {},
      platform: "win32",
    })

    expect(lines).toEqual(["INFO Daemon: unavailable on win32 (no unix socket to share)"])
    expect(engine.calls).toHaveLength(0)
  })

  test("an unknown subcommand prints usage and exits 2 without touching the engine", () => {
    const { pluginRoot, agentDir } = workspace()
    const engine = fakeEngine({ exitCode: 0, stdout: "" })
    const stderr = capture()

    const exitCode = runDaemonCommand(["frobnicate"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout: capture(),
      stderr,
      platform: "darwin",
    })

    expect(exitCode).toBe(2)
    expect(engine.calls).toHaveLength(0)
    expect(stderr.text()).toContain("usage")
  })

  test("stop and handoff reach the engine as their own subcommands", () => {
    const { pluginRoot, agentDir } = workspace()
    for (const [command, expected] of [
      ["stop", "stop"],
      ["handoff", "handoff"],
    ] as const) {
      const engine = fakeEngine({ exitCode: 0, stdout: JSON.stringify({ action: expected }) })
      runDaemonCommand([command], {
        engine,
        pluginRoot,
        agentDir,
        env: {},
        stdout: capture(),
        stderr: capture(),
        platform: "darwin",
      })
      expect(engine.calls.at(-1)?.args.slice(0, 2)).toEqual(["host", expected])
    }
  })

  test("--help prints usage on stdout and exits 0", () => {
    const { pluginRoot, agentDir } = workspace()
    const engine = fakeEngine({ exitCode: 0, stdout: "" })
    const stdout = capture()

    const exitCode = runDaemonCommand(["--help"], {
      engine,
      pluginRoot,
      agentDir,
      env: {},
      stdout,
      stderr: capture(),
      platform: "darwin",
    })

    expect(exitCode).toBe(0)
    expect(engine.calls).toHaveLength(0)
    expect(stdout.text()).toContain("usage: omo daemon")
  })
})
