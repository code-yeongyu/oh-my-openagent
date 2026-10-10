import { dirname } from "node:path"
import { propagateResult, runChild } from "./bin/lib/child-process.js"
import { isProvisionedExecutable } from "./compile-runtime"

// Set on the child a launch hands off to, naming the provisioned executable the parent spawned. The
// child trusts it over its own executable identity, which Bun on Windows has misreported before, so
// every child provisioned and re-exec'd again (#7445, #7447): the provisioned exe never re-execs itself.
export const PROVISIONED_HANDOFF_ENV = "OMO_PROVISIONED_HANDOFF"

export type ProvisionedLaunch = { readonly provision: boolean; readonly handOff: boolean; readonly execDir: string }
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
  delete env[PROVISIONED_HANDOFF_ENV]
  if (handedOff) return { provision: false, handOff: false, execDir: dirname(expected) }
  const provision = !isProvisionedExecutable(runningExecutable, expected)
  return { provision, handOff: provision, execDir: dirname(runningExecutable) }
}

export async function reexecProvisionedRuntime(expected: string, options: ReexecOptions = {}): Promise<void> {
  const argv = options.argv ?? process.argv.slice(2)
  const env = options.env ?? process.env
  const run = options.run ?? runChild
  const propagate = options.propagate ?? propagateResult
  const execve = options.execve === undefined ? process.execve : options.execve
  if ((options.platform ?? process.platform) !== "win32" && typeof execve === "function") {
    try {
      execve(expected, [expected, ...argv], env)
      return
    } catch {
      // A provisioned binary that cannot replace this image still uses the async fallback.
    }
  }
  const result = await run(expected, argv, { env })
  propagate(result)
}

export async function handOffToProvisionedRuntime(expected: string, options: ReexecOptions = {}): Promise<void> {
  const env = { ...(options.env ?? process.env), [PROVISIONED_HANDOFF_ENV]: expected }
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
