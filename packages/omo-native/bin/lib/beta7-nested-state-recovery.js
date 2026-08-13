import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const STATE_FILES = ["settings.json", "auth.json", "models.json"]

/**
 * Recovers state a beta.7 install may have left under `~/.omo/agent`.
 *
 * Beta.7 pinned the engine's agent dir to `~/.omo/agent` while the brand migration still wrote
 * flat `~/.omo`, so a hand-migrated user could end up with real credentials only in the nested
 * dir. Copy-never-move, never overwrite, idempotent: files are copied only when the flat
 * sentinel (`~/.omo/settings.json`) is absent and a nested state file exists, so an existing
 * flat store always wins and a second run is a no-op. Returns the names of copied files.
 */
export function recoverBeta7NestedAgentState(homeDir) {
  const flatDir = join(homeDir, ".omo")
  const nestedDir = join(flatDir, "agent")
  if (existsSync(join(flatDir, "settings.json"))) return []

  const copied = []
  for (const name of STATE_FILES) {
    const nested = join(nestedDir, name)
    const flat = join(flatDir, name)
    if (existsSync(nested) && !existsSync(flat)) {
      mkdirSync(flatDir, { recursive: true })
      copyFileSync(nested, flat)
      copied.push(name)
    }
  }
  return copied
}
