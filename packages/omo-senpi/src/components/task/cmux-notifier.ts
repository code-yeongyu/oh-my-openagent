import { spawn } from "node:child_process"
import { accessSync, constants, existsSync } from "node:fs"
import { delimiter, join } from "node:path"

export interface CmuxNotificationOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly spawnImpl?: typeof spawn
}

const KNOWN_MACOS_CMUX_PATHS = [
  "/Applications/cmux.app/Contents/Resources/bin/cmux",
]

export function resolveCmuxExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
  const override = env.OMO_CMUX_BIN?.trim() || env.CMUX_OMO_CMUX_BIN?.trim()
  if (override !== undefined && override.length > 0) return override
  const pathExecutable = findExecutableOnPath("cmux", env.PATH)
  if (pathExecutable !== null) return pathExecutable
  return findFirstExecutable(KNOWN_MACOS_CMUX_PATHS)
}

export function isCmuxEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.CMUX_SOCKET_PATH || env.CMUX_AGENT_LAUNCH_KIND || env.OMO_SENPI_CMUX_NOTIFY === "1")
}

export function sendCmuxNotification(
  title: string,
  body: string,
  options: CmuxNotificationOptions = {},
): Promise<boolean> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  if (platform !== "darwin" || env.OMO_SENPI_CMUX_NOTIFY === "0" || !isCmuxEnvironment(env)) return Promise.resolve(false)
  const executable = resolveCmuxExecutable(env)
  if (executable === null) return Promise.resolve(false)

  const spawnImpl = options.spawnImpl ?? spawn
  return new Promise((resolve) => {
    const child = spawnImpl(executable, ["notify", "--title", title, "--body", body], {
      stdio: "ignore",
      windowsHide: true,
    })
    child.once("error", () => resolve(false))
    child.once("close", (code) => resolve(code === 0))
  })
}

function findFirstExecutable(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Continue searching the remaining known locations.
    }
  }
  return null
}

function findExecutableOnPath(command: string, pathValue: string | undefined): string | null {
  if (pathValue === undefined) return null
  for (const directory of pathValue.split(delimiter)) {
    if (directory.length === 0) continue
    const candidate = join(directory, command)
    if (!existsSync(candidate)) continue
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      // Continue searching the remaining PATH entries.
    }
  }
  return null
}
