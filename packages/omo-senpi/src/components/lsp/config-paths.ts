import { existsSync } from "node:fs"
import { join } from "node:path"

// senpi's brand-dir migration moves `~/.pi/*` and a project's `.pi/*` into `.omo/` (#8370), so the
// branded directory is read first and `.pi` stays a read-only fallback for trees not yet migrated.
const CONFIG_DIRS = [".omo", ".pi"] as const
const LSP_CONFIG_FILE = "lsp-client.json"
const INSTALL_DECISIONS_FILE = "lsp-install-decisions.json"

type Exists = (path: string) => boolean

export function projectLspConfigPaths(cwd: string): string[] {
  return CONFIG_DIRS.map((dir) => join(cwd, dir, LSP_CONFIG_FILE))
}

export function userLspConfigPath(home: string, exists: Exists = existsSync): string {
  return firstExistingOrBranded(home, LSP_CONFIG_FILE, exists)
}

export function lspInstallDecisionsPath(home: string, exists: Exists = existsSync): string {
  return firstExistingOrBranded(home, INSTALL_DECISIONS_FILE, exists)
}

function firstExistingOrBranded(root: string, file: string, exists: Exists): string {
  const candidates = CONFIG_DIRS.map((dir) => join(root, dir, file))
  return candidates.find((path) => exists(path)) ?? join(root, CONFIG_DIRS[0], file)
}
