import { spawn, type SpawnOptions } from "node:child_process"
import { accessSync, constants, existsSync } from "node:fs"
import { delimiter, join } from "node:path"

export interface CmuxNotificationOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly spawnImpl?: CmuxSpawnImpl
  readonly timeoutMs?: number
}

export type CmuxSpawnImpl = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => CmuxNotificationChild

interface CmuxNotificationChild {
  once(event: "error", listener: () => void): CmuxNotificationChild
  once(event: "close", listener: (code: number | null) => void): CmuxNotificationChild
  unref(): void
  kill(): boolean
}

const DEFAULT_CMUX_NOTIFICATION_TIMEOUT_MS = 5_000
const MAX_CMUX_BODY_CHARS = 4_000
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
  return env.TMUX?.includes("cmuxterm") === true ||
    Boolean(env.CMUX_SOCKET_PATH || env.CMUX_AGENT_LAUNCH_KIND || env.OMO_SENPI_CMUX_NOTIFY === "1")
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

  const spawnImpl = options.spawnImpl ?? spawnCmuxProcess
  let child: CmuxNotificationChild
  try {
    child = spawnImpl(executable, ["notify", "--title", title, "--body", truncateNotificationBody(body)], {
      stdio: "ignore",
      windowsHide: true,
    })
  } catch (error) {
    if (error instanceof Error) return Promise.resolve(false)
    return Promise.resolve(false)
  }
  child.unref()

  return new Promise((resolve) => {
    let completed = false
    const complete = (result: boolean) => {
      if (completed) return
      completed = true
      clearTimeout(timeout)
      resolve(result)
    }
    const timeout = setTimeout(() => {
      child.kill()
      complete(false)
    }, options.timeoutMs ?? DEFAULT_CMUX_NOTIFICATION_TIMEOUT_MS)
    timeout.unref()

    child.once("error", () => complete(false))
    child.once("close", (code) => complete(code === 0))
  })
}

function spawnCmuxProcess(command: string, args: readonly string[], options: SpawnOptions): CmuxNotificationChild {
  return spawn(command, args, options)
}

function findFirstExecutable(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch (error) {
      if (!(error instanceof Error)) throw error
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
    } catch (error) {
      if (!(error instanceof Error)) throw error
      // Continue searching the remaining PATH entries.
    }
  }
  return null
}

function truncateNotificationBody(body: string): string {
  if (body.length <= MAX_CMUX_BODY_CHARS) return body
  return `${body.slice(0, MAX_CMUX_BODY_CHARS - 1)}…`
}
