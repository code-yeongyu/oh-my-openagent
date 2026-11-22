import { closeSync, fstatSync } from "node:fs"
import { dirname, isAbsolute } from "node:path"
import { propagateResult, runChild } from "./bin/lib/child-process.js"
import { inspectPrivateFdTable, PRIVATE_FDS_ENV, privateFdHandoffFor } from "./bin/lib/private-fd-table.js"
import { isProvisionedExecutable } from "./compile-runtime"

// Set on the child a launch hands off to, naming the provisioned executable the parent spawned. The
// child trusts it over its own executable identity, which Bun on Windows has misreported before, so
// every child provisioned and re-exec'd again (#7445, #7447): the provisioned exe never re-execs itself.
export const PROVISIONED_HANDOFF_ENV = "OMO_PROVISIONED_HANDOFF"
// Set beside the handoff marker, naming the binary the user installed and launched. The provisioned
// child is what answers `omo update`, and its own executable is the runtime copy the launcher
// re-materializes on every run, so replacing that copy never updates anything.
export const PROVISIONED_LAUNCHER_ENV = "OMO_PROVISIONED_LAUNCHER"

export type ProvisionedLaunch = {
  readonly provision: boolean
  readonly handOff: boolean
  readonly execDir: string
  /** The installed binary that started this launch; undefined when the runtime copy was run directly. */
  readonly launcher?: string
}
type ReexecOptions = {
  argv?: string[]
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  execve?: ((file: string, argv: string[], env: NodeJS.ProcessEnv) => void) | null
  run?: typeof runChild
  propagate?: typeof propagateResult
}

/**
 * The engine resolves package.json, themes and native prebuilds beside process.execPath, so a launch
 * from anywhere but the provisioned runtime - a raw release download on any platform - hands off to it
 * rather than running the engine in-process (#7485).
 */
export function planProvisionedLaunch(
  runningExecutable: string,
  expected: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): ProvisionedLaunch {
  const env = options.env ?? process.env
  const handedOff = env[PROVISIONED_HANDOFF_ENV] === expected
  const parentLauncher = env[PROVISIONED_LAUNCHER_ENV]
  delete env[PROVISIONED_HANDOFF_ENV]
  delete env[PROVISIONED_LAUNCHER_ENV]
  if (handedOff) {
    return {
      provision: false,
      handOff: false,
      execDir: dirname(expected),
      launcher: handedOffLauncher(parentLauncher, expected),
    }
  }
  const provision = !isProvisionedExecutable(runningExecutable, expected)
  return {
    provision,
    handOff: provision,
    execDir: dirname(runningExecutable),
    launcher: provision ? runningExecutable : undefined,
  }
}

// Only an absolute path that is not the runtime copy itself can name the installed binary.
function handedOffLauncher(launcher: string | undefined, expected: string): string | undefined {
  if (launcher === undefined || !isAbsolute(launcher)) return undefined
  return isProvisionedExecutable(launcher, expected) ? undefined : launcher
}

// senpi's startup hand-off (`SENPI_RPC_HOST_STARTUP_EVENTS`) and the pipe it names at `STARTUP_EVENT_FD`.
const STARTUP_EVENTS_ENV = "SENPI_RPC_HOST_STARTUP_EVENTS"
const STARTUP_EVENT_FD = 16

function holdsStartupPipe(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  if (platform === "win32" || !env[STARTUP_EVENTS_ENV]) return false
  try {
    const stat = fstatSync(STARTUP_EVENT_FD)
    return stat.isSocket() || stat.isFIFO()
  } catch {
    return false
  }
}

/** A coordinated engine start keeps its startup pipe across the handoff: execve would close it (#13622). */
type ChildHandoff = { env: NodeJS.ProcessEnv; stdio: (string | number)[]; onSpawn?: () => void }

function withStartupPipe(handoff: ChildHandoff | undefined, env: NodeJS.ProcessEnv): ChildHandoff {
  const base = handoff ?? { env, stdio: ["inherit", "inherit", "inherit"] }
  const stdio: (string | number)[] = [...base.stdio]
  while (stdio.length <= STARTUP_EVENT_FD) stdio.push("ignore")
  stdio[STARTUP_EVENT_FD] = STARTUP_EVENT_FD
  return { ...base, stdio }
}

export async function reexecProvisionedRuntime(expected: string, options: ReexecOptions = {}): Promise<void> {
  const argv = options.argv ?? process.argv.slice(2)
  const env = options.env ?? process.env
  const run = options.run ?? runChild
  const propagate = options.propagate ?? propagateResult
  const execve = options.execve === undefined ? process.execve : options.execve
  const platform = options.platform ?? process.platform
  // execve would drop the launch's private descriptors (senpi#4749), so that launch takes the child path.
  const table = env[PRIVATE_FDS_ENV]
  // The compiled Windows hop captures the pair too; helper spawns must never see its declaration.
  if (platform === "win32") delete env[PRIVATE_FDS_ENV]
  const privateHandoff = privateFdHandoffFor(env, table, platform)
  const handoff = holdsStartupPipe(env, platform) ? withStartupPipe(privateHandoff, env) : privateHandoff
  // Named sockets it cannot forward would stay open in this waiting parent, so their peer never saw EOF.
  if (handoff !== undefined) for (const fd of inspectPrivateFdTable(table, platform).discard) closeSync(fd)
  if (handoff === undefined && platform !== "win32" && typeof execve === "function") {
    try {
      execve(expected, [expected, ...argv], env)
      return
    } catch {
      // A provisioned binary that cannot replace this image still uses the async fallback.
    }
  }
  const result = await run(expected, argv, handoff ?? { env })
  propagate(result)
}

export async function handOffToProvisionedRuntime(
  expected: string,
  options: ReexecOptions & { launcher?: string } = {},
): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...(options.env ?? process.env), [PROVISIONED_HANDOFF_ENV]: expected }
  if (options.launcher === undefined) delete env[PROVISIONED_LAUNCHER_ENV]
  else env[PROVISIONED_LAUNCHER_ENV] = options.launcher
  // Ctrl+C reaches every process on a Windows console. The child answers its own copy; this parent
  // keeps waiting for the child's exit code instead of dying first and handing the prompt back early.
  const waitForChild = () => {}
  if ((options.platform ?? process.platform) === "win32") process.on("SIGINT", waitForChild)
  try {
    await reexecProvisionedRuntime(expected, { ...options, env })
  } finally {
    process.off("SIGINT", waitForChild)
  }
}
