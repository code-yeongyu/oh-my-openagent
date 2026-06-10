import { spawnSync } from "node:child_process"
import { constants as osConstants } from "node:os"
import { isAbsolute, resolve } from "node:path"
import {
  createDefaultSparkShellAppServerClient,
  type RuntimeEnv,
  type SparkShellAppServerClient,
  type SparkShellAppServerCommand,
  type SparkShellAppServerResult,
} from "./sparkshell-appserver"
import {
  hasTopLevelSparkShellHelpFlag,
  parseSparkShellFallbackInvocation,
  SPARKSHELL_USAGE,
  type SparkShellFallbackInvocation,
} from "./sparkshell-parse"

export const SPARKSHELL_BIN_ENV = "OMO_SPARKSHELL_BIN"

export type { SparkShellAppServerClient, SparkShellAppServerCommand, SparkShellAppServerResult }

export {
  parseSparkShellFallbackInvocation,
  resolveFallbackShellArgv,
  SPARKSHELL_USAGE,
} from "./sparkshell-parse"

export type SparkShellSpawnResult = {
  readonly status?: number | null
  readonly signal?: string | null
  readonly stdout?: string
  readonly stderr?: string
  readonly error?: Error
}

export type SparkShellSpawn = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: RuntimeEnv },
) => SparkShellSpawnResult

export type SparkShellRunOptions = {
  readonly cwd?: string
  readonly env?: RuntimeEnv
  readonly platform?: NodeJS.Platform
  readonly spawn?: SparkShellSpawn
  readonly writeStdout?: (value: string) => void
  readonly writeStderr?: (value: string) => void
  readonly commandExists?: (command: string) => boolean
  readonly appServerClient?: SparkShellAppServerClient | null
}

export async function runSparkShell(args: readonly string[], options: SparkShellRunOptions = {}): Promise<number> {
  const env = options.env ?? process.env
  const writeStdout = options.writeStdout ?? ((value: string) => process.stdout.write(value))
  const writeStderr = options.writeStderr ?? ((value: string) => process.stderr.write(value))
  const cwd = options.cwd ?? process.cwd()

  if (hasTopLevelSparkShellHelpFlag(args)) {
    writeStdout(`${SPARKSHELL_USAGE}\n`)
    return 0
  }

  if (args.length === 0) {
    writeStderr(`Missing command to run.\n${SPARKSHELL_USAGE}\n`)
    return 1
  }

  const nativeBinaryPath = resolveNativeBinaryOverride(env, cwd)
  const spawn = options.spawn ?? defaultSpawn
  if (nativeBinaryPath.length > 0) {
    return runSpawnedCommand(spawn, nativeBinaryPath, args, { cwd, env }, writeStdout, writeStderr)
  }

  const appServerClient = options.appServerClient === undefined ? createDefaultSparkShellAppServerClient(env) : options.appServerClient
  if (appServerClient) {
    try {
      return await runAppServerCommand(args, appServerClient, {
        cwd,
        env,
        platform: options.platform,
        commandExists: options.commandExists ?? defaultCommandExists,
        spawn,
        writeStdout,
        writeStderr,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeStderr(`[sparkshell] appserver unavailable (${message}); falling back to raw command execution without summary support.\n`)
    }
  }

  let invocation: SparkShellFallbackInvocation
  try {
    invocation = parseSparkShellFallbackInvocation(args, {
      platform: options.platform,
      env,
      commandExists: options.commandExists ?? defaultCommandExists,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeStderr(`${message}\n`)
    return 1
  }

  const [command, ...commandArgs] = invocation.argv
  if (command === undefined) {
    writeStderr(`Missing command to run.\n${SPARKSHELL_USAGE}\n`)
    return 1
  }
  return runSpawnedCommand(spawn, command, commandArgs, { cwd, env }, writeStdout, writeStderr)
}

function resolveNativeBinaryOverride(env: RuntimeEnv, cwd: string): string {
  const override = env[SPARKSHELL_BIN_ENV]?.trim() || ""
  if (override.length === 0) {
    return ""
  }
  return isAbsolute(override) || /^[A-Za-z]:[\\/]/.test(override) ? override : resolve(cwd, override)
}

async function runAppServerCommand(
  args: readonly string[],
  appServerClient: SparkShellAppServerClient,
  options: {
    readonly cwd: string
    readonly env: RuntimeEnv
    readonly platform?: NodeJS.Platform
    readonly commandExists: (command: string) => boolean
    readonly spawn: SparkShellSpawn
    readonly writeStdout: (value: string) => void
    readonly writeStderr: (value: string) => void
  },
): Promise<number> {
  let invocation: SparkShellFallbackInvocation
  const platform = isShellInvocation(args) ? await appServerClient.getPlatform() : options.platform
  try {
    invocation = parseSparkShellFallbackInvocation(args, {
      platform,
      env: options.env,
      commandExists: platform === "win32" ? isDefaultWindowsAppServerShell : options.commandExists,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    options.writeStderr(`${message}\n`)
    return 1
  }

  if (invocation.kind === "tmux-pane") {
    const [command, ...commandArgs] = invocation.argv
    if (command === undefined) {
      options.writeStderr(`Missing command to run.\n${SPARKSHELL_USAGE}\n`)
      return 1
    }
    return runSpawnedCommand(options.spawn, command, commandArgs, { cwd: options.cwd, env: options.env }, options.writeStdout, options.writeStderr)
  }

  const result = await appServerClient.exec({
    argv: invocation.argv,
    cwd: options.cwd,
    env: options.env,
  })
  if (result.stdout.length > 0) {
    options.writeStdout(result.stdout)
  }
  if (result.stderr.length > 0) {
    options.writeStderr(result.stderr)
  }
  return result.exitCode
}

function isDefaultWindowsAppServerShell(command: string): boolean {
  return command === "powershell.exe"
}

function isShellInvocation(args: readonly string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (token === "--") {
      const next = args[index + 1]
      return next === "--shell" || next?.startsWith("--shell=") === true
    }
    if (token === "--json") {
      continue
    }
    if (token === "--budget") {
      index += 1
      continue
    }
    if (token?.startsWith("--budget=")) {
      continue
    }
    return token === "--shell" || token?.startsWith("--shell=") === true
  }
  return false
}

function runSpawnedCommand(
  spawn: SparkShellSpawn,
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: RuntimeEnv },
  writeStdout: (value: string) => void,
  writeStderr: (value: string) => void,
): number {
  const result = spawn(command, args, options)
  if (result.stdout && result.stdout.length > 0) {
    writeStdout(result.stdout)
  }
  if (result.stderr && result.stderr.length > 0) {
    writeStderr(result.stderr)
  }
  if (result.error) {
    writeStderr(`[sparkshell] failed to launch ${command}: ${result.error.message}\n`)
    return 1
  }
  if (typeof result.status === "number") {
    return result.status
  }
  return signalExitCode(result.signal)
}

function signalExitCode(signal: string | null | undefined): number {
  if (!signal) {
    return 1
  }
  const signalNumber = Object.entries(osConstants.signals).find(([name]) => name === signal)?.[1]
  return typeof signalNumber === "number" && Number.isFinite(signalNumber) ? 128 + signalNumber : 1
}

function defaultCommandExists(command: string): boolean {
  const result = spawnSync(command, ["--version"], {
    stdio: "ignore",
  })
  return result.error === undefined
}

function defaultSpawn(command: string, args: readonly string[], options: { readonly cwd: string; readonly env: RuntimeEnv }): SparkShellSpawnResult {
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
    encoding: "utf8",
  })
  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdout: typeof result.stdout === "string" ? result.stdout : undefined,
    stderr: typeof result.stderr === "string" ? result.stderr : undefined,
  }
}
