import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { teardownRoots } from "./teardown.test-support"

// Signal forwarding on the bun runtime. `launcher.js:spawnSenpi` hands the engine over one of two
// ways, and only one of them has a wrapper process that can forward anything:
//
//   - POSIX on a runtime with `process.execve` (node >= 22) replaces its own image, so there is no
//     wrapper, no forwarding, and nothing to test here.
//   - Every other shape - EVERY bun, because bun has no `process.execve`, and win32 - calls
//     `spawnNode`, which is `child-process.js:runChild`, the single place omo installs a signal
//     handler or touches the child.
//
// So on bun the launcher is a real parent process and this module is what keeps a Ctrl-C or a
// supervisor SIGTERM from orphaning the engine. The probe below clears `process.execve` before
// `runLauncher` so it takes the same branch bun and Windows already take natively rather than
// simulating it.
//
// Contracts this suite does NOT own, because another test already pins them at their own boundary:
// the death-by-signal propagation of `propagateResult` (child-process-signal.test.ts), the execve
// handoff itself (launcher.test.ts), and the re-exec layer under bun (child-process-signal.test.ts).

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))

// `OMO_SIGNAL_GRACE_MS` of 0 cannot express "the budget is spent": `graceMs()` in child-process.js
// treats a non-positive value as unset and falls back to DEFAULT_GRACE_MS, so the tightest budget
// the contract honours is 1ms. Both the 0 fallback and the 1ms budget are pinned below.
const GRACE_REACHED_MS = "1"
const GRACE_NOT_REACHED_MS = "15000"

type SignalName = "SIGHUP" | "SIGINT" | "SIGQUIT" | "SIGUSR1" | "SIGUSR2" | "SIGTERM" | "SIGCONT" | "SIGPIPE"

// Signals `runChild` installs a listener for and forwards to the engine.
const FORWARDED_SIGNALS = ["SIGTERM", "SIGHUP"] as const
// Signals `runChild` installs a listener for and deliberately does NOT forward.
const WAITED_SIGNALS = ["SIGINT"] as const
// Signals `runChild` installs no listener for at all, so the runtime's own disposition applies and
// nothing can be forwarded.
const UNHANDLED_SIGNALS = ["SIGQUIT", "SIGUSR1", "SIGUSR2", "SIGCONT", "SIGPIPE"] as const

type LaunchMode = "posix" | "rpc" | "internal-rpc-host-supervisor"

const LAUNCH_MODES: readonly { mode: LaunchMode; argv: readonly string[] }[] = [
  { mode: "posix", argv: ["hello"] },
  { mode: "rpc", argv: ["--mode", "rpc", "hello"] },
  { mode: "internal-rpc-host-supervisor", argv: ["--internal-rpc-host-supervisor", "--socket", "{SOCKET}", "hello"] },
]

/**
 * The engine child: a sleep loop that records every signal it is given. A handler is installed for
 * all eight so an unexpected signal is observable in the log rather than silently killing the
 * child, which is what makes "the launcher never sent this" a fact about the log instead of a fact
 * about a process that happened to stay alive.
 */
const ENGINE_SOURCE = `
import { appendFileSync, writeFileSync } from "node:fs"
writeFileSync(process.env.PID_FILE, String(process.pid))
for (const signal of ${JSON.stringify([...FORWARDED_SIGNALS, ...WAITED_SIGNALS, ...UNHANDLED_SIGNALS])}) {
  process.on(signal, () => {
    appendFileSync(process.env.SIGNAL_LOG, signal + "\\n")
    // A graceful engine drains for a while and then reports its own exit code; a stuck one never
    // leaves and forces the launcher to run out its grace budget.
    if (process.env.ENGINE_IGNORES_SIGNALS !== "1") {
      setTimeout(() => process.exit(Number(process.env.ENGINE_EXIT_CODE ?? 0)), Number(process.env.ENGINE_DRAIN_MS ?? 200))
    }
  })
}
writeFileSync(process.env.READY_FILE, JSON.stringify(process.argv.slice(2)) + "\\n")
setInterval(() => {}, 1000)
`

type Fixture = {
  root: string
  probePath: string
  readyFile: string
  signalLog: string
  pidFile: string
  socketPath: string
}

const roots: string[] = []
const livePids: number[] = []

function writeFixtureFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function expandShortPath(path: string): string {
  if (process.platform !== "win32") return path
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

function createFixture(argv: readonly string[]): Fixture {
  const root = expandShortPath(realpathSync(mkdtempSync(join(tmpdir(), "omo-bun-signal-"))))
  roots.push(root)
  const packageRoot = join(root, "pkg")
  cpSync(join(SOURCE_ROOT, "bin"), join(packageRoot, "bin"), { recursive: true })
  writeFixtureFile(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "omo-ai", version: "1.2.3-test.0", type: "module" }),
  )

  const senpiRoot = join(packageRoot, "node_modules", "@code-yeongyu", "senpi")
  writeFixtureFile(
    join(senpiRoot, "package.json"),
    JSON.stringify({ name: "@code-yeongyu/senpi", version: "2026.8.9", type: "module", exports: { ".": "./dist/index.js" } }),
  )
  writeFixtureFile(join(senpiRoot, "dist", "index.js"), "export const fixture = true\n")
  writeFixtureFile(join(senpiRoot, "dist", "cli.js"), ENGINE_SOURCE)
  writeFixtureFile(join(senpiRoot, "dist", "core", "brand.js"), "export {}\n")
  // An engine on a real machine is stamped by postinstall or by the previous launch; stamping the
  // fixture keeps `ensureEnginePrepared` from trying to prepare an engine that has no real vendor
  // tree, which it reports as a reinstall warning on every single case.
  writeFixtureFile(join(senpiRoot, ".omo-engine-prepared"), "1.2.3-test.0\n")

  const socketPath = join(root, "rpc.sock")
  const resolvedArgv = argv.map((arg) => arg.replace("{SOCKET}", socketPath))
  const probePath = join(packageRoot, "probe.mjs")
  writeFixtureFile(
    probePath,
    `import { runLauncher } from "./bin/lib/launcher.js"
process.execve = undefined
await runLauncher(${JSON.stringify(resolvedArgv)})
`,
  )

  return {
    root,
    probePath,
    readyFile: join(root, "engine-ready.json"),
    signalLog: join(root, "engine-signals.log"),
    pidFile: join(root, "engine.pid"),
    socketPath,
  }
}

type LauncherRun = {
  pid: number
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  hasExited: () => boolean
  output: () => string
}

function startLauncher(fixture: Fixture, env: NodeJS.ProcessEnv): LauncherRun {
  const inherited: NodeJS.ProcessEnv = {
    ...process.env,
    // The agent directory must never be inherited from the developer's own export; the case would
    // otherwise assert on the configured override instead of the launch under test.
    OMO_CODING_AGENT_DIR: join(fixture.root, "agent"),
  }
  delete inherited.SENPI_CODING_AGENT_DIR
  delete inherited.PI_CODING_AGENT_DIR

  const child = spawn(process.execPath, [fixture.probePath], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...inherited,
      ...env,
      READY_FILE: fixture.readyFile,
      SIGNAL_LOG: fixture.signalLog,
      PID_FILE: fixture.pidFile,
    },
  })
  let output = ""
  child.stdout.on("data", (chunk) => (output += String(chunk)))
  child.stderr.on("data", (chunk) => (output += String(chunk)))
  let hasExited = false
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.on("exit", (code, signal) => {
      hasExited = true
      resolveExit({ code, signal })
    })
  })
  if (child.pid !== undefined) livePids.push(child.pid)
  return { pid: child.pid ?? -1, exit, hasExited: () => hasExited, output: () => output }
}

async function waitForProcessGone(pid: number, timeoutMs = 10_000): Promise<void> {
  if (pid <= 0) return
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch {
      return
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  throw new Error(`pid ${pid} survived its own teardown`)
}

function readSignals(fixture: Fixture): string[] {
  if (!existsSync(fixture.signalLog)) return []
  return readFileSync(fixture.signalLog, "utf8").trim().split("\n").filter(Boolean)
}

/**
 * Signals a launcher that may already be gone. A signal the runtime answers with its own default
 * disposition ends the launcher outright, and sending the next one to a dead pid is ESRCH, which is
 * the expected outcome of that case rather than an error.
 */
function signalLauncher(pid: number, signal: SignalName): void {
  try {
    process.kill(pid, signal)
  } catch {
    // The launcher already took its own disposition for an earlier signal.
  }
}

/**
 * Settles once the launcher has demonstrably processed a signal sent earlier in the case. SIGTERM
 * is the barrier because `runChild` forwards it: the engine logging SIGTERM proves the launcher was
 * still running and still had a handler. Signals from one sender to one receiver are delivered in
 * ascending signal-number order, so by the time the engine has logged SIGTERM (15) the launcher has
 * already been handed every signal this case sent before it - SIGINT (2), SIGQUIT (3), SIGUSR1 (10),
 * SIGUSR2 (12) and SIGPIPE (13) all sort ahead of it.
 *
 * The loser of the race is left settling on its own, so its rejection is absorbed here rather than
 * surfacing as an unhandled error after the case has already moved on.
 */
async function settleAfterSignal(fixture: Fixture, launcher: LauncherRun): Promise<void> {
  const barrier = waitForEngineSignal(fixture, "SIGTERM")
  barrier.catch(() => undefined)
  signalLauncher(launcher.pid, "SIGTERM")
  await Promise.race([launcher.exit, barrier])
}

async function waitForReady(fixture: Fixture, launcher: LauncherRun, timeoutMs = 15_000): Promise<string[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(fixture.readyFile)) return JSON.parse(readFileSync(fixture.readyFile, "utf8")) as string[]
    if (launcher.hasExited()) throw new Error(`the launcher exited before the engine started: ${launcher.output()}`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  throw new Error(`the engine never reported ready: ${launcher.output()}`)
}

async function waitForEngineSignal(fixture: Fixture, signal: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (readSignals(fixture).includes(signal)) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  throw new Error(`the engine never received ${signal}; it received [${readSignals(fixture).join(", ")}]`)
}

function enginePid(fixture: Fixture): number {
  return Number(readFileSync(fixture.pidFile, "utf8").trim())
}

/**
 * Ends both processes this case started. The launcher is killed first so it cannot forward anything
 * while the engine is going down, then both are confirmed gone before the root is removed.
 */
async function shutdown(launcher: LauncherRun, fixture: Fixture): Promise<void> {
  let engine = -1
  try {
    engine = enginePid(fixture)
  } catch {
    // The engine never wrote its pid; there is nothing to clean up beyond the launcher.
  }
  for (const pid of [launcher.pid, engine]) {
    if (pid <= 0) continue
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // Already gone: the case asserted on its own exit, so this is the expected tail.
    }
    const tracked = livePids.indexOf(pid)
    if (tracked !== -1) livePids.splice(tracked, 1)
  }
  for (const pid of [launcher.pid, engine]) await waitForProcessGone(pid)
  rmSync(fixture.root, { recursive: true, force: true })
  roots.splice(roots.indexOf(fixture.root), 1)
}

afterEach(async () => {
  for (const pid of livePids.splice(0)) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // Already exited on its own.
    }
    await waitForProcessGone(pid)
  }
  teardownRoots(roots)
})

// `runChild` installs no listeners at all on win32, so there is nothing here to forward and every
// signal assertion below would be measuring the platform rather than the launcher. POSIX only.
const describePosix = process.platform === "win32" ? describe.skip : describe

describePosix("bun runtime launcher signal forwarding", () => {
  for (const { mode, argv } of LAUNCH_MODES) {
    describe(`#given the launcher in ${mode} mode #when the engine starts`, () => {
      test("#then it is a separate process reached through the signal-aware child path", async () => {
        // given
        const fixture = createFixture(argv)
        const launcher = startLauncher(fixture, { OMO_SIGNAL_GRACE_MS: GRACE_NOT_REACHED_MS })
        try {
          // when
          const forwardedArgv = await waitForReady(fixture, launcher)
          // then: the mode's argv survived the launcher's own command routing and reached the
          // engine behind the `--extension` prefix the launcher always adds. A mode whose argv were
          // intercepted by a launcher branch would never get an engine, and with it no signal
          // contract at all, so the rest of this suite would be asserting on nothing.
          expect(forwardedArgv[0]).toBe("--extension")
          expect(forwardedArgv[1]).toBe(join(fixture.root, "pkg", "plugin"))
          expect(forwardedArgv.slice(2)).toEqual(argv.map((arg) => arg.replace("{SOCKET}", fixture.socketPath)))
          expect(enginePid(fixture)).toBeGreaterThan(0)
          expect(enginePid(fixture)).not.toBe(launcher.pid)
        } finally {
          await shutdown(launcher, fixture)
        }
      }, 30_000)
    })
  }

  for (const signal of FORWARDED_SIGNALS) {
    for (const { mode, argv } of LAUNCH_MODES) {
      describe(`#given a launcher in ${mode} mode with a draining engine #when it receives ${signal}`, () => {
        test(`#then the engine receives ${signal} and its own exit code is what the launcher reports`, async () => {
          // given: a budget the engine's drain finishes inside.
          const fixture = createFixture(argv)
          const launcher = startLauncher(fixture, {
            OMO_SIGNAL_GRACE_MS: GRACE_NOT_REACHED_MS,
            ENGINE_DRAIN_MS: "300",
            ENGINE_EXIT_CODE: "0",
          })
          try {
            await waitForReady(fixture, launcher)

            // when
            signalLauncher(launcher.pid, signal)

            // then: the signal reached the engine.
            await waitForEngineSignal(fixture, signal)
            // and the engine finished its own shutdown inside the budget, so its answer wins.
            const result = await launcher.exit
            expect(result.code).toBe(0)
            expect(result.signal).toBeNull()
            await waitForProcessGone(enginePid(fixture))
          } finally {
            await shutdown(launcher, fixture)
          }
        }, 30_000)

        test(`#then a stuck engine still ends the launcher by ${signal} once the budget is spent`, async () => {
          // given: an engine that logs the signal and refuses to leave, with a budget it cannot outlast.
          const fixture = createFixture(argv)
          const launcher = startLauncher(fixture, {
            OMO_SIGNAL_GRACE_MS: GRACE_REACHED_MS,
            ENGINE_IGNORES_SIGNALS: "1",
          })
          try {
            await waitForReady(fixture, launcher)
            const stuck = enginePid(fixture)

            // when
            signalLauncher(launcher.pid, signal)

            // then: the launcher re-raises the signal on itself instead of hanging on the engine.
            expect(await launcher.exit).toEqual({ code: null, signal })
            // and the engine was told before that, so a stuck engine is never left uninformed.
            expect(readSignals(fixture)).toContain(signal)
            // the launcher is gone but the stuck engine is not its problem to reap; the case owns it.
            expect(isAlive(stuck)).toBe(true)
          } finally {
            await shutdown(launcher, fixture)
          }
        }, 30_000)
      })
    }
  }

  for (const { mode, argv } of LAUNCH_MODES) {
    describe(`#given a launcher in ${mode} mode #when it receives SIGINT`, () => {
      test("#then the engine is never interrupted and the launcher keeps waiting", async () => {
        // given
        const fixture = createFixture(argv)
        const launcher = startLauncher(fixture, { OMO_SIGNAL_GRACE_MS: GRACE_NOT_REACHED_MS })
        try {
          await waitForReady(fixture, launcher)

          // when: a tty already delivered SIGINT to the whole foreground process group.
          signalLauncher(launcher.pid, "SIGINT")

          // then: the launcher installed a handler for SIGINT (it is still here to receive the
          // SIGTERM that follows) and forwarded nothing, because a second delivery would interrupt
          // the engine while it is already draining from the tty's own copy.
          await settleAfterSignal(fixture, launcher)
          expect(readSignals(fixture)).toContain("SIGTERM")
          expect(readSignals(fixture)).not.toContain("SIGINT")
          expect(isAlive(launcher.pid)).toBe(true)
          expect(isAlive(enginePid(fixture))).toBe(true)
        } finally {
          await shutdown(launcher, fixture)
        }
      }, 30_000)

      test("#then the launcher still ends by SIGINT once the budget is spent, having forwarded nothing", async () => {
        // given
        const fixture = createFixture(argv)
        const launcher = startLauncher(fixture, {
          OMO_SIGNAL_GRACE_MS: GRACE_REACHED_MS,
          ENGINE_IGNORES_SIGNALS: "1",
        })
        try {
          await waitForReady(fixture, launcher)

          // when
          signalLauncher(launcher.pid, "SIGINT")

          // then: SIGINT gets the same bounded wait as SIGTERM even though nothing was forwarded.
          expect(await launcher.exit).toEqual({ code: null, signal: "SIGINT" })
          expect(readSignals(fixture)).not.toContain("SIGINT")
        } finally {
          await shutdown(launcher, fixture)
        }
      }, 30_000)
    })
  }

  for (const signal of UNHANDLED_SIGNALS) {
    for (const { mode, argv } of LAUNCH_MODES) {
      describe(`#given a launcher in ${mode} mode #when it receives ${signal}`, () => {
        test(`#then the engine is never given ${signal}`, async () => {
          // given
          const fixture = createFixture(argv)
          const launcher = startLauncher(fixture, {
            OMO_SIGNAL_GRACE_MS: GRACE_NOT_REACHED_MS,
            ENGINE_IGNORES_SIGNALS: "1",
          })
          try {
            await waitForReady(fixture, launcher)

            // when
            signalLauncher(launcher.pid, signal)
            // The launcher installs no listener for this signal, so it either takes the runtime's
            // own disposition and dies outright, or the runtime ignores it and the launcher keeps
            // running. The SIGTERM barrier covers the second case; the first settles on `launcher.exit`.
            await settleAfterSignal(fixture, launcher)

            // then
            expect(readSignals(fixture)).not.toContain(signal)
          } finally {
            await shutdown(launcher, fixture)
          }
        }, 30_000)
      })
    }
  }

  describe("#given the launcher budget environment #when it is configured with 0", () => {
    test("#then 0 is read as unset and the engine's own exit code still decides the launcher's", async () => {
      // given: an engine that needs 500ms to drain, and a budget spelled 0.
      const fixture = createFixture(["hello"])
      const launcher = startLauncher(fixture, {
        OMO_SIGNAL_GRACE_MS: "0",
        ENGINE_DRAIN_MS: "500",
        ENGINE_EXIT_CODE: "0",
      })
      try {
        await waitForReady(fixture, launcher)

        // when
        signalLauncher(launcher.pid, "SIGTERM")

        // then: 0 means "unset", so the default budget applied and the engine drained inside it.
        // A 0 that were honoured instead would expire long before a 500ms drain and end the
        // launcher by SIGTERM, so this outcome is what distinguishes the two readings.
        await waitForEngineSignal(fixture, "SIGTERM")
        expect(await launcher.exit).toEqual({ code: 0, signal: null })
      } finally {
        await shutdown(launcher, fixture)
      }
    }, 30_000)
  })
})

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}