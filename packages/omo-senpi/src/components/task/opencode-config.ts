import { existsSync } from "node:fs"
import { join } from "node:path"

// opencode-family task config file names the plugin historically read. Their presence alongside an
// omo.json is the dual-config coexistence signal (Metis #17): senpi reads omo.json only.
const OPENCODE_CONFIG_FILENAMES = [
  "oh-my-openagent.json",
  "oh-my-openagent.jsonc",
  "oh-my-opencode.json",
  "oh-my-opencode.jsonc",
] as const

// True when a project-local .opencode/oh-my-openagent.json[c]-family config exists. Intentionally a
// narrow, project-scoped check (no HOME walk) so the one-time warning is precise and cheap.
export function detectOpencodeConfig(cwd: string): boolean {
  return OPENCODE_CONFIG_FILENAMES.some((name) => existsSync(join(cwd, ".opencode", name)))
}
