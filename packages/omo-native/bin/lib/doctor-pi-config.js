import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { join } from "node:path"
import { canonicalAgentDir, runtimeHome } from "./agent-dir.js"

// Mirrors the engine's legacy-pi-edits check (senpi `src/legacy-pi-edits.ts`), which this package
// cannot import synchronously: the same four files, the same `legacyPiAgentDir.copiedAt` record in
// migrations-state.json, and the same rule: newer than the recorded copy (or, before the time was
// recorded, than the agent copy's preserved mtime) and different in content. `~/.pi/agent` is only
// read (#9173).
export const PI_CONFIG_FILES = ["auth.json", "keybindings.json", "models.json", "settings.json"]

function fileStat(path) {
  try {
    const stat = statSync(path)
    return stat.isFile() ? stat : undefined
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return undefined
    throw error
  }
}

function recordedCopyTime(agentDir) {
  let state
  try {
    state = JSON.parse(readFileSync(join(agentDir, "migrations-state.json"), "utf8"))
  } catch {
    // A missing or hand-broken state file means no recorded copy time; the rule falls back.
    return undefined
  }
  const copiedAt = state?.schemaVersion === 1 ? state.legacyPiAgentDir?.copiedAt : undefined
  return typeof copiedAt === "number" && Number.isFinite(copiedAt) ? copiedAt : undefined
}

export function findPiConfigEdits({ agentDir, homeDir }) {
  const piAgentDir = join(homeDir, ".pi", "agent")
  if (!existsSync(piAgentDir)) return []
  if (existsSync(agentDir) && realpathSync(agentDir) === realpathSync(piAgentDir)) return []
  const copiedAt = recordedCopyTime(agentDir)
  const edits = []
  for (const file of PI_CONFIG_FILES) {
    const piPath = join(piAgentDir, file)
    const agentPath = join(agentDir, file)
    const pi = fileStat(piPath)
    if (pi === undefined) continue
    const agent = fileStat(agentPath)
    if (pi.mtimeMs <= (copiedAt ?? agent?.mtimeMs ?? 0)) continue
    if (agent !== undefined && readFileSync(piPath).equals(readFileSync(agentPath))) continue
    edits.push({ file, piPath, agentPath })
  }
  return edits
}

export function formatPiConfigLines(agentDir, edits) {
  return [
    `INFO config dir: ${agentDir}`,
    ...edits.map((edit) =>
      `WARN You edited ${edit.piPath} after omo moved to ${agentDir}; omo reads ${edit.agentPath}. Copy your change there (or run: omo config import-pi ${edit.file}).`),
  ]
}

export function piConfigReport(options = {}) {
  const env = options.env ?? process.env
  const agentDir = options.agentDir ?? canonicalAgentDir(env)
  const homeDir = options.homeDir ?? runtimeHome(env)
  try {
    return formatPiConfigLines(agentDir, findPiConfigEdits({ agentDir, homeDir }))
  } catch (error) {
    return [`INFO config dir: ${agentDir}`, `WARN could not check ${join(homeDir, ".pi", "agent")} for config edits: ${error.message}`]
  }
}
