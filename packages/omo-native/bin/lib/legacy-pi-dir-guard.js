import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const LEGACY_PI_DIR_MIGRATION_RELATIVE = "dist/legacy-senpi-dir-migration.js"

// Live upstream pi trees (`~/.pi/agent`, `cwd/.pi`) must stay put. Nested leftovers
// under the branded `.omo` directory can still be absorbed.
export const LIVE_PI_DIR_MOVES = `    const moves = [
        [join(cwd, ".pi"), projectNewDir, "project config directory"],
        [join(cwd, CONFIG_DIR_NAME, ".pi"), projectNewDir, "nested project config directory"],
    ];
    if (shouldMigrateHomeConfig) {
        moves.unshift([join(homeDir, ".pi", "agent"), globalNewAgentDir, "global agent directory"], [join(homeDir, CONFIG_DIR_NAME, ".pi", "agent"), globalNewAgentDir, "nested global agent directory"], [join(homeDir, ".pi", "mom"), globalNewMomDir, "global mom directory"], [join(homeDir, CONFIG_DIR_NAME, ".pi", "mom"), globalNewMomDir, "nested global mom directory"]);
    }
`

export const NESTED_PI_DIR_MOVES = `    const moves = [
        [join(cwd, CONFIG_DIR_NAME, ".pi"), projectNewDir, "nested project config directory"],
    ];
    if (shouldMigrateHomeConfig) {
        moves.unshift([join(homeDir, CONFIG_DIR_NAME, ".pi", "agent"), globalNewAgentDir, "nested global agent directory"], [join(homeDir, CONFIG_DIR_NAME, ".pi", "mom"), globalNewMomDir, "nested global mom directory"]);
    }
`

/**
 * Stops Senpi's branded-dir migration from emptying a sibling `@earendil-works/pi-coding-agent`
 * install on every `omo` launch (https://github.com/code-yeongyu/oh-my-openagent/issues/8039).
 */
export function patchLegacyPiDirMigration(senpiRoot) {
  const path = join(senpiRoot, LEGACY_PI_DIR_MIGRATION_RELATIVE)
  if (!existsSync(path)) throw new Error(`omo-ai: installed Senpi target is missing: ${LEGACY_PI_DIR_MIGRATION_RELATIVE}`)
  const source = readFileSync(path, "utf8")
  if (source.includes(LIVE_PI_DIR_MOVES)) {
    writeFileSync(path, source.replace(LIVE_PI_DIR_MOVES, NESTED_PI_DIR_MOVES))
    return "rewritten"
  }
  if (source.includes(NESTED_PI_DIR_MOVES)) return "already-patched"
  throw new Error(`omo-ai: unsupported Senpi ${LEGACY_PI_DIR_MIGRATION_RELATIVE}`)
}
