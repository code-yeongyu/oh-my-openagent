import { chmodSync, mkdirSync } from "node:fs"
import { join } from "node:path"

/**
 * The directories a scratch sandbox is made of. senpi >= 2026.11.10-3 refuses an RPC key directory that is group-
 * or world-writable (unsafe_key_record), and mkdir's mode is masked by the caller's umask (002 on the shared QA
 * hosts), so the agent dir is tightened to 0700 explicitly.
 */
export function createScratchLayout(dir) {
  const home = join(dir, "home")
  const agentDir = join(dir, "agent")
  const work = join(dir, "work")
  for (const path of [home, agentDir, work, join(agentDir, "omo-senpi", "omo-native")])
    mkdirSync(path, { recursive: true })
  chmodSync(agentDir, 0o700)
  return { home, agentDir, work }
}
