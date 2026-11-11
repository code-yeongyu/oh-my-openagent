// The launcher-independent half of the boot-time memory-sync gate (#11997), shared by every entry that starts an
// engine: omo-native's compiled entry and npm launcher, and the desktop's own entry through the device-account
// sidecar. It reads only the argv, the table's names and the process's runtime facts, so it has no imports and
// captures nothing; an entry adds its own launcher checks (omo's one-shot engine commands) on top.

const MEMORY_SYNC_CHANNEL = "memory-sync"
const INTERNAL_SUPERVISOR_FLAG = "--internal-rpc-host-supervisor"
const ISOLATED_CHILD_ENV = "SENPI_CLI_ISOLATED_CHILD"

/** The runtime facts senpi's CLI reads to decide whether it re-runs itself in another process. */
export type EngineRuntimeFacts = {
  readonly execArgv: readonly string[]
  readonly versions: { readonly bun?: string | undefined }
}

/**
 * Whether senpi's CLI, imported into this process, hands the run to a child it spawns instead of loading the agent
 * here. That child gets the descriptors the CLI still holds, so a descriptor the boot claim took would be missing in
 * the process that runs the agent. Mirrors @code-yeongyu/senpi 2026.11.5-1 (the module is private to dist/cli.js):
 * - requiresIsolatedProcess(), dist/cli.js:169-175: no SENPI_CLI_ISOLATED_CHILD=1 marker and either exec arguments
 *   or an inherited Inspector option (hasInheritedInspectorOption(), dist/inspector-policy.js: an exec argument
 *   starting with --inspect, or NODE_OPTIONS containing --inspect);
 * - reexecUnderBunIfNeeded(), dist/cli.js:85-122: a process not running on Bun may re-run itself under Bun
 *   (resolveBunReexec(), dist/bun-runtime.js:165-188, decides from runtime pins and the Bun it can find). The gate
 *   does not resolve that install, so any non-Bun runtime counts as one that may re-run; its claim stays with the
 *   memory component's registration in the process that runs the agent.
 */
function engineRerunsInChild(env: Readonly<Record<string, string | undefined>>, runtime: EngineRuntimeFacts): boolean {
  if (runtime.versions.bun === undefined) return true
  if (env[ISOLATED_CHILD_ENV] === "1") return false
  return runtime.execArgv.length > 0 || env.NODE_OPTIONS?.includes("--inspect") === true
}

/**
 * Whether an engine launch with these senpi args claims memory sync at boot: an `--mode rpc` launch that is not the
 * lifecycle supervisor (options after `--` are message text) and whose private-descriptor table names memory-sync.
 * `host ensure` and the supervisor forward the descriptor to the next hop untouched, so they never claim it, and
 * neither does a process whose CLI re-runs the engine in a child (engineRerunsInChild). A table that does not parse
 * to an object leaves the claim to the extension. `env` and `runtime` are those of the process senpi's CLI will run in
 * (this one by default). Pure: safe to call before senpi's cwd guard and filler release.
 */
export function claimsMemorySyncAtBoot(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
  runtime: EngineRuntimeFacts = process,
): boolean {
  const end = args.indexOf("--")
  const options = end === -1 ? args : args.slice(0, end)
  if (options.includes(INTERNAL_SUPERVISOR_FLAG)) return false
  if (!options.some((arg, index) => arg === "--mode" && options[index + 1] === "rpc")) return false
  const table = env.SENPI_PRIVATE_FDS
  if (!table) return false
  if (engineRerunsInChild(env, runtime)) return false
  try {
    const parsed: unknown = JSON.parse(table)
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.hasOwn(parsed, MEMORY_SYNC_CHANNEL)
    )
  } catch {
    return false
  }
}
