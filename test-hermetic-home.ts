/// <reference types="bun-types" />
import { afterAll } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { createConnection } from "node:net"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { markTestInfrastructureDir, runTestTempRootTeardown } from "./test-temp-root"

const AGENT_DIR_ENV_NAMES = ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"] as const

export interface HermeticHome {
  readonly home: string
  readonly agentDir: string
}

// os.homedir() keeps the OS home it read at process start and ignores a later HOME change, so the
// engine's agent-dir lookup (these variables first, os.homedir() otherwise) would still land in the
// user's real agent dir: a test that starts a session or a task host then writes there (#9578).
// Every reader takes the first set name in OMO > SENPI > PI order. The two that a run inherited from
// a live omo session are dropped and only the LAST is pinned to the hermetic home, so a test that sets
// OMO_ or SENPI_CODING_AGENT_DIR for itself or a child still wins exactly as it did before.
export function installHermeticHome(): HermeticHome {
  const home = mkdtempSync(join(tmpdir(), "omo-test-home-"))
  markTestInfrastructureDir(home)
  process.env.HOME = home
  process.env.USERPROFILE = home
  // Both root and package-local preloads must override os.homedir()'s retained host memory root.
  process.env.OMO_MEMORY_HOME = join(home, ".omo", "memory")
  const agentDir = join(home, ".omo", "agent")
  for (const name of AGENT_DIR_ENV_NAMES) delete process.env[name]
  process.env.PI_CODING_AGENT_DIR = agentDir
  // The user skill roots follow these too: the OpenCode config dir falls back to os.homedir()/.config,
  // which the HOME change above does not move, and a developer's shell may export any of them. Left
  // alone, a user skill (a `ulw-plan` in ~/.config/opencode/skills) outranks the shared one (#10632).
  process.env.XDG_CONFIG_HOME = join(home, ".config")
  delete process.env.OPENCODE_CONFIG_DIR
  delete process.env.CLAUDE_CONFIG_DIR
  installHermeticSecrets()
  installHermeticGitConfig(home)
  // Loaded now, not at teardown: a cold engine import costs about a second under load, which must not come out
  // of the stop deadline (#11630).
  const engine = preloadTaskHostEngine()
  afterAll(async () => {
    // The temp-root teardown reads and removes the directory these hosts write into, so it waits for them
    // to exit, and it runs even when the shard check throws: a later preload afterAll does not run
    // once an earlier one has failed (#9766).
    await runCheckThenTeardown(async () => {
      const failures: unknown[] = []
      await stopRunTaskHosts(agentDir, { loadEngine: () => engine }).catch((error: unknown) => failures.push(error))
      try {
        failOnShardsInRealAgentDir()
      } catch (error) {
        failures.push(error)
      }
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, failures.map(describeError).join("\n"))
    }, runTestTempRootTeardown)
  })
  return { home, agentDir }
}

// The OS credential store ignores HOME: a test that reads sign-in state (memory sync reads the
// `omo login` credentials on every session bind) would see the developer's real credentials and
// could reach the live service. Each test process gets its own empty in-memory store instead.
function installHermeticSecrets(): void {
  const values = new Map<string, string>()
  const keyOf = (key: { readonly service: string; readonly name: string }) => `${key.service}\u0000${key.name}`
  Object.defineProperty(Bun, "secrets", {
    value: {
      get: async (key: { readonly service: string; readonly name: string }) => values.get(keyOf(key)) ?? null,
      set: async (key: { readonly service: string; readonly name: string; readonly value: string }) => {
        values.set(keyOf(key), key.value)
      },
      delete: async (key: { readonly service: string; readonly name: string }) => values.delete(keyOf(key)),
    },
  })
}

// git >= 2.47 follows a commit, merge, fetch or push with a detached `git maintenance run --auto`. No test started
// it, so no teardown waits for it, and it keeps writing .git/objects/pack while the test removes its scratch
// repository: the directory survives the temp-root leak check (#11742; per-fixture fixes before it: #10177, #10945).
// This global config turns that off for every git child of a test, including git started by a CLI under test.
// A repository's own config still outranks it, so a test that turns auto maintenance on for its repository keeps it.
// - maintenance.auto=false: no automatic maintenance after any command.
// - maintenance.autoDetach=false, gc.autoDetach=false: where a repository turns it back on, it runs in the foreground
//   and has finished when the git command returns.
// gc.auto is left alone: commands reach `gc --auto` only through auto maintenance, and product code reads gc.auto to
// pick its own repository defaults.
const HERMETIC_GIT_CONFIG = "[maintenance]\n\tauto = false\n\tautoDetach = false\n[gc]\n\tautoDetach = false\n"

function installHermeticGitConfig(home: string): void {
  const path = join(home, ".gitconfig")
  writeFileSync(path, HERMETIC_GIT_CONFIG)
  // HOME already names this file. GIT_CONFIG_GLOBAL also reaches a child started with its own HOME, and replaces a
  // global config path the run inherited, which git would read instead of ~/.gitconfig.
  process.env.GIT_CONFIG_GLOBAL = path
}

/** Runs the teardown after the check even when the check throws; when both throw, both errors are reported. */
export async function runCheckThenTeardown(
  check: () => Promise<void>,
  teardown: () => void | Promise<void>,
): Promise<void> {
  let checkFailure: { readonly error: unknown } | undefined
  try {
    await check()
  } catch (error) {
    checkFailure = { error }
  }
  try {
    await teardown()
  } catch (teardownError) {
    if (checkFailure) {
      // bun test prints only an AggregateError's own message, so both inner messages go into it.
      const errors = [checkFailure.error, teardownError]
      throw new AggregateError(errors, `The shard check and the temp-root teardown both failed (#9766):\n${errors.map(describeError).join("\n")}`)
    }
    throw teardownError
  }
  if (checkFailure) throw checkFailure.error
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The part of the engine's host API the teardown uses; tests pass their own. */
export interface TaskHostEngine {
  listHostEndpoints(agentDir: string): Promise<readonly { readonly socket: string | null; readonly endpoint_kind: string }[]>
  stopHost(options: { readonly socket: string; readonly agentDir: string; readonly force: boolean; readonly timeoutMs: number }): Promise<
    { readonly action: string; readonly pid?: number; readonly reason?: string }
  >
}

/** What a connect to a host's socket says: someone accepts, nothing can be there, or no answer either way. */
export type SocketState = "listening" | "gone" | "unknown"

// Bun's hook budget is 5 s for every file after the first unless --timeout is passed. The engine gets its own
// short wait (it was preloaded at setup, so it is normally ready), and only then does the stop deadline start,
// so a slow import is never reported as a host that is "still stopping". Both together stay inside the budget.
const TASK_HOST_ENGINE_WAIT_MS = 1_000
const TASK_HOST_STOP_DEADLINE_MS = 3_000
const ENGINE_CALL_TIMEOUT_MS = 1_000

/**
 * Stops the task hosts this run started, within a deadline (#11630).
 *
 * A test that boots the packaged extension can start a real task host. The engine registers every host it
 * spawns in the agent dir it was given, with the host's pid and start time, and this run's agent dir is a
 * mkdtemp of its own: the hosts registered there are exactly the ones this run (or a child that inherited
 * its environment) started. The engine's own stop signals a host only after proving that its registration
 * names the live process, so nothing here decides from a process-table scan: a scan by path matched
 * processes this run never started, and its wait was unbounded under load.
 *
 * A stop the engine refuses (a host that already exited released its registration; on Windows the engine
 * records no start time, so it never proves a host and the teardown can only report one) is settled by a
 * connect to the host's socket: nothing there is "gone", and anything else, a listener or no answer in time,
 * is reported. A host still running when the deadline passes fails the run by name too, never as an unnamed
 * hook timeout.
 */
export async function stopRunTaskHosts(
  agentDir: string,
  options: {
    readonly deadlineMs?: number
    readonly engineWaitMs?: number
    readonly loadEngine?: () => Promise<TaskHostEngine>
    readonly probeSocket?: (socket: string, timeoutMs: number) => Promise<SocketState>
  } = {},
): Promise<void> {
  if (!existsSync(join(agentDir, "rpc-host-daemon"))) return
  const deadlineMs = options.deadlineMs ?? TASK_HOST_STOP_DEADLINE_MS
  const engineWaitMs = options.engineWaitMs ?? TASK_HOST_ENGINE_WAIT_MS
  const probe = options.probeSocket ?? probeSocket
  const engine = await within((options.loadEngine ?? loadTaskHostEngine)(), engineWaitMs).catch((error: unknown) => {
    throw new Error(`The engine needed to stop this run's task hosts did not load (#11630): ${describeError(error)}`)
  })
  if (engine === undefined) {
    throw new Error(`The engine needed to stop this run's task hosts did not load within ${engineWaitMs}ms (#11630); hosts registered in ${agentDir} were not stopped`)
  }
  const deadline = Date.now() + deadlineMs
  const unsettled = new Map<string, string>()
  const leftovers: string[] = []
  const stopAll = async (): Promise<void> => {
    const sockets = (await engine.listHostEndpoints(agentDir))
      .filter((endpoint) => endpoint.endpoint_kind === "rpc_host")
      .flatMap((endpoint) => (endpoint.socket === null ? [] : [endpoint.socket]))
    for (const socket of sockets) unsettled.set(socket, "still stopping")
    await Promise.all(sockets.map(async (socket) => {
      const leftover = await stopOne(engine, probe, agentDir, socket, deadline, (state) => unsettled.set(socket, state))
      unsettled.delete(socket)
      if (leftover !== undefined) leftovers.push(leftover)
    }))
  }
  const finished = await within(
    stopAll().then(
      () => true,
      (error: unknown) => {
        throw new Error(`Stopping the task hosts this run started failed (#11630): ${describeError(error)}`)
      },
    ),
    Math.max(0, deadline - Date.now()),
  )
  if (finished === undefined) {
    leftovers.push(...[...unsettled].map(([socket, state]) => `${socket} (${state})`))
    if (unsettled.size === 0) leftovers.push(`the engine did not list the host registry in ${agentDir} in time`)
  }
  if (leftovers.length === 0) return
  throw new Error(
    `Task hosts this run started were still running ${deadlineMs}ms into the end-of-run teardown (#11630):\n`
      + leftovers.map((leftover) => `  ${leftover}`).join("\n"),
  )
}

/** Resolves with the work's value, or with undefined once `ms` has passed; a rejection passes through. */
async function within<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return await Promise.race([
    work,
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

async function stopOne(
  engine: TaskHostEngine,
  probe: (socket: string, timeoutMs: number) => Promise<SocketState>,
  agentDir: string,
  socket: string,
  deadline: number,
  progress: (state: string) => void,
): Promise<string | undefined> {
  const result = await engine.stopHost({ socket, agentDir, force: true, timeoutMs: ENGINE_CALL_TIMEOUT_MS })
  if (result.action === "stopped" && result.pid !== undefined) {
    progress(`pid ${result.pid} signalled, not exited`)
    if (await exitedBy(result.pid, deadline)) return undefined
    return `${socket} (pid ${result.pid} did not exit after SIGTERM)`
  }
  const refusal = result.reason ?? result.action
  progress(`stop refused (${refusal}), connecting to its socket`)
  const state = await probe(socket, ENGINE_CALL_TIMEOUT_MS)
  if (state === "gone") return undefined
  return state === "listening"
    ? `${socket} (stop refused: ${refusal}; a host still listens on the socket)`
    : `${socket} (stop refused: ${refusal}; the socket did not answer a connect within ${ENGINE_CALL_TIMEOUT_MS}ms, so the host may still be running)`
}

/**
 * Connects to a host socket without speaking its protocol: an accepted connection is a live listener; a
 * missing path or a refused connect (a socket file its host left behind) means nothing is there. Anything
 * else, a timeout included, is unknown, never taken for gone.
 */
export function probeSocket(socket: string, timeoutMs: number): Promise<SocketState> {
  return new Promise((resolve) => {
    const connection = createConnection(socket)
    const settle = (state: SocketState): void => {
      clearTimeout(timer)
      connection.destroy()
      resolve(state)
    }
    const timer = setTimeout(() => settle("unknown"), timeoutMs)
    connection.once("connect", () => settle("listening"))
    connection.once("error", (error) => {
      const code = "code" in error ? error.code : undefined
      settle(code === "ENOENT" || code === "ECONNREFUSED" ? "gone" : "unknown")
    })
  })
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH")
  }
}

async function exitedBy(pid: number, deadline: number): Promise<boolean> {
  while (processAlive(pid)) {
    if (Date.now() >= deadline) return false
    await Bun.sleep(25)
  }
  return true
}

async function loadTaskHostEngine(): Promise<TaskHostEngine> {
  const engine = await import("@code-yeongyu/senpi")
  return {
    listHostEndpoints: (agentDir) => engine.listHostEndpoints(agentDir),
    stopHost: (options) => engine.stopHost(options),
  }
}

/** Starts the engine import at setup; a failure surfaces only if teardown finds hosts to stop. */
function preloadTaskHostEngine(): Promise<TaskHostEngine> {
  const engine = loadTaskHostEngine()
  // Marks the rejection handled here only; teardown awaits this same promise and reports the error then.
  engine.catch(() => undefined)
  return engine
}

const REAL_AGENT_DIRS = [join(homedir(), ".omo", "agent"), join(homedir(), ".senpi", "agent"), join(homedir(), ".omo")]

// A host shard registered under a real agent dir by THIS test process is a leak. The shard meta
// records its creator, so a live session's own shards on the same machine are never counted.
function failOnShardsInRealAgentDir(): void {
  const leaked = REAL_AGENT_DIRS.flatMap((agentDir) => shardsCreatedBy(join(agentDir, "rpc", "shards"), process.pid))
  if (leaked.length === 0) return
  throw new Error(
    `test process ${process.pid} registered task host shards in the real agent dir (#9578): ${leaked.join(", ")}`,
  )
}

// A pid is reused, so a shard left by an earlier process that held this pid names it as creator too.
// Only a shard created at or after this process started can be this process's leak; a shard whose
// created_at cannot be parsed is still reported, so a malformed meta never hides a leak.
export function shardsCreatedBy(
  shardsDir: string,
  pid: number,
  startedAt: number = Date.now() - process.uptime() * 1000,
): string[] {
  let names: string[]
  try {
    names = readdirSync(shardsDir)
  } catch {
    return []
  }
  return names
    .filter((name) => name.endsWith(".meta.json"))
    .map((name) => join(shardsDir, name))
    .filter((metaPath) => {
      const meta = readShardMeta(metaPath)
      if (meta.created_by_pid !== pid) return false
      const createdAt = typeof meta.created_at === "string" ? Date.parse(meta.created_at) : Number.NaN
      return Number.isNaN(createdAt) || createdAt >= startedAt
    })
}

function readShardMeta(metaPath: string): { created_by_pid?: unknown; created_at?: unknown } {
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")) as { created_by_pid?: unknown; created_at?: unknown }
  } catch {
    return {}
  }
}
