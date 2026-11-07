import { isEngineCommand } from "./engine-commands.js"

// #11997: a `--mode rpc` engine whose launch carried a private-descriptor table naming memory-sync starts that claim
// before senpi's CLI loads, because a multi-session host (what `host ensure` starts) loads extensions only when a
// session opens, and the desktop opens none before it has answered the claim's bootstrap frame. This only reads the
// argv and the table's names; it captures nothing, and any table it cannot read leaves the claim to the extension.
const MEMORY_SYNC_CHANNEL = "memory-sync"
const INTERNAL_SUPERVISOR_FLAG = "--internal-rpc-host-supervisor"

/** Whether this engine launch should claim memory sync at boot. */
export function claimsMemorySyncAtBoot(args, env = process.env) {
  if (isEngineCommand(args)) return false
  const end = args.indexOf("--")
  const options = end === -1 ? args : args.slice(0, end)
  if (options.includes(INTERNAL_SUPERVISOR_FLAG)) return false
  if (!options.some((arg, index) => arg === "--mode" && options[index + 1] === "rpc")) return false
  const table = env.SENPI_PRIVATE_FDS
  if (!table) return false
  try {
    const parsed = JSON.parse(table)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && Object.hasOwn(parsed, MEMORY_SYNC_CHANNEL)
  } catch {
    return false
  }
}
