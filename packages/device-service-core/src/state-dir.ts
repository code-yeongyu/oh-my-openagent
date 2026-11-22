import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, posix, win32 } from "node:path"

type Env = Readonly<Record<string, string | undefined>>

/** Set by the device service on every process it launches: the absolute state dir it runs with. */
export const DEVICE_SERVICE_STATE_DIR_ENV = "OMO_DEVICE_SERVICE_STATE_DIR"

// Maintained by the device service's install-service beside the default state dir: {"v":1,"state_dir":"<absolute>"}.
const LOCATION_FILE = "device-service.location.json"

const isAbsoluteOn = (platform: NodeJS.Platform, path: string): boolean =>
  (platform === "win32" ? win32 : posix).isAbsolute(path)

function defaultStateDir(platform: NodeJS.Platform, env: Env, home: string): string {
  if (platform !== "win32") return join(home, ".omo", "device-service")
  const localAppData = env.LOCALAPPDATA ?? join(home, "AppData", "Local")
  return join(localAppData, "OmO", "device-service")
}

// The contract is a silent fall-through: an unreadable, unparsable or dangling discovery file means the default.
function discoveredStateDir(platform: NodeJS.Platform, defaultDir: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dirname(defaultDir), LOCATION_FILE), "utf8"))
    if (typeof parsed !== "object" || parsed === null || !("v" in parsed) || !("state_dir" in parsed)) return undefined
    const { v, state_dir: stateDir } = parsed
    if (v !== 1 || typeof stateDir !== "string" || !isAbsoluteOn(platform, stateDir)) return undefined
    return statSync(stateDir).isDirectory() ? stateDir : undefined
  } catch {
    return undefined
  }
}

/**
 * Where the service's endpoint and per-boot token live: a non-empty absolute `OMO_DEVICE_SERVICE_STATE_DIR`, else the
 * existing absolute directory named by `device-service.location.json` beside the default dir, else the default
 * `~/.omo/device-service` (POSIX) or `%LOCALAPPDATA%\OmO\device-service` (Windows).
 */
export function deviceServiceStateDir(
  platform: NodeJS.Platform = process.platform,
  env: Env = process.env,
  home: string = homedir(),
): string {
  const explicit = env[DEVICE_SERVICE_STATE_DIR_ENV]
  if (explicit !== undefined && explicit !== "" && isAbsoluteOn(platform, explicit)) return explicit
  const defaultDir = defaultStateDir(platform, env, home)
  return discoveredStateDir(platform, defaultDir) ?? defaultDir
}
