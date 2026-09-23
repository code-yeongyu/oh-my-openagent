import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { floorClaudeCodeVersion } from "./claude-code-floor.js"
import { prepareCompileSafeEngine } from "./compile-safe-engine.js"
import { prepareRpcStreamErrors } from "./rpc-stream-errors.js"

// Written inside the engine tree, so reinstalling or upgrading the engine drops it with the tree.
export const ENGINE_PREPARED_STAMP = ".omo-engine-prepared"

export function prepareInstalledEngine(senpiRoot) {
  floorClaudeCodeVersion(senpiRoot)
  prepareCompileSafeEngine(senpiRoot)
  prepareRpcStreamErrors(senpiRoot)
}

export function writeEnginePreparedStamp(senpiRoot, omoVersion) {
  writeFileSync(join(senpiRoot, ENGINE_PREPARED_STAMP), `${omoVersion}\n`)
}

function isPreparedFor(senpiRoot, omoVersion) {
  const stamp = join(senpiRoot, ENGINE_PREPARED_STAMP)
  return existsSync(stamp) && readFileSync(stamp, "utf8").trim() === omoVersion
}

/**
 * postinstall prepares the engine, but it never runs under `ignore-scripts=true` or Bun's blocked
 * postinstalls (#8713). The launcher therefore prepares an unstamped engine before starting it.
 * A failure is reported with the reinstall command and never blocks the launch: an unprepared
 * engine still runs, only without the guards.
 */
export function ensureEnginePrepared({ senpiRoot, omoVersion, reinstallCommand, report = (line) => { process.stderr.write(line) } }) {
  if (isPreparedFor(senpiRoot, omoVersion)) return
  try {
    prepareInstalledEngine(senpiRoot)
    writeEnginePreparedStamp(senpiRoot, omoVersion)
  } catch (error) {
    report(`omo: could not prepare the installed engine (${error.message}); reinstall with: ${reinstallCommand}\n`)
  }
}
