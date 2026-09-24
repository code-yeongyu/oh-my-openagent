import { join } from "node:path"
import { runChild } from "./child-process.js"
import { packageManifest, readJson, resolveSenpi, updateTarget } from "./package-paths.js"

const PRINT_ONLY_FLAGS = new Set(["--dry-run", "--print"])

export function isPrintOnlyUpdate(args) {
  return args.slice(1).some((arg) => PRINT_ONLY_FLAGS.has(arg))
}

export function formatUpdateCommand(update) {
  return `omo is updated via ${update.manager}: ${update.command}`
}

export function readInstalledVersion() {
  let engine = "unknown"
  try {
    engine = readJson(join(resolveSenpi().packageRoot, "package.json")).version
  } catch {
    // The product version is still reportable when the engine tree cannot be resolved.
  }
  return { omo: packageManifest().version, engine }
}

export function formatVersionChange(before, after) {
  return `omo ${before.omo} -> ${after.omo} (engine: senpi ${after.engine})`
}

/**
 * Prints and optionally runs the package-manager command `updateTarget()` resolved. `--dry-run`
 * and `--print` keep the print-only answer; anything else streams the spawn, then reports the
 * installed versions. A failed manager run exits non-zero with the same command to retry by hand.
 * `run` defaults to `runChild` so tests inject a spawn without touching the child-process helper.
 *
 * @typedef {{ omo: string, engine: string }} InstalledVersion
 * @typedef {{ status: number | null, signal: string | null }} ChildResult
 * @typedef {{ stdio?: "inherit", windowsHide?: boolean, env?: NodeJS.ProcessEnv }} RunOptions
 * @typedef {{
 *   update?: { manager: string, command: string, argv: string[], env?: Record<string, string> },
 *   log?: (line: string) => void,
 *   error?: (line: string) => void,
 *   run?: (command: string, args: string[], options?: RunOptions) => Promise<ChildResult>,
 *   readInstalled?: () => InstalledVersion,
 *   env?: NodeJS.ProcessEnv,
 * }} SelfUpdateOptions
 * @param {string[]} args
 * @param {SelfUpdateOptions} [options]
 * @returns {Promise<number>}
 */
export async function runSelfUpdate(args, options = {}) {
  const update = options.update ?? updateTarget()
  const log = options.log ?? ((line) => console.log(line))
  const error = options.error ?? ((line) => console.error(line))
  const run = options.run ?? runChild
  const readInstalled = options.readInstalled ?? readInstalledVersion
  const env = options.env ?? process.env

  log(formatUpdateCommand(update))
  if (isPrintOnlyUpdate(args)) return 0

  const before = readInstalled()
  const [command, ...argv] = update.argv
  let result
  try {
    result = await run(command, argv, {
      stdio: "inherit",
      windowsHide: true,
      env: { ...env, ...update.env },
    })
  } catch {
    error(`omo: update failed; retry with: ${update.command}`)
    return 1
  }

  if (result.signal || (result.status ?? 1) !== 0) {
    error(`omo: update failed; retry with: ${update.command}`)
    return result.status ?? 1
  }

  log(formatVersionChange(before, readInstalled()))
  return 0
}
