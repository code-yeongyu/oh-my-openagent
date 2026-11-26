import { execFile } from "node:child_process"
import { accessSync, constants, realpathSync, statSync } from "node:fs"
import { delimiter, join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const VERSION_TIMEOUT_MS = 60_000

/**
 * The first executable `omo` on `env.PATH`, the one a shell runs, or undefined when there is none.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | undefined}
 */
export function findOmoOnPath(env) {
  for (const entry of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(entry, "omo")
    try {
      accessSync(candidate, constants.X_OK)
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Not on this PATH entry; the shell would keep looking too.
    }
  }
  return undefined
}

export function realpathOrSelf(path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * Runs `<launcher> --version` and returns its last output line (`omo <version> (engine: ...)`), or a
 * `failed: ...` line when it cannot run, so a broken launcher is reported instead of thrown.
 * @param {string} launcher
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<string>}
 */
export async function readLauncherVersion(launcher, env) {
  try {
    const { stdout } = await execFileAsync(launcher, ["--version"], { env, timeout: VERSION_TIMEOUT_MS })
    return stdout.trim().split("\n").at(-1) ?? ""
  } catch (error) {
    return `failed: ${String(error instanceof Error ? error.message : error).split("\n")[0]}`
  }
}

export function reportsVersion(line, version) {
  return line === `omo ${version}` || line.startsWith(`omo ${version} `)
}
