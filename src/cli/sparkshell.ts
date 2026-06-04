import { spawnSync } from "node:child_process"
import { constants as osConstants } from "node:os"
import { isAbsolute, resolve } from "node:path"
import {
  hasTopLevelSparkShellHelpFlag,
  parseSparkShellFallbackInvocation,
  SPARKSHELL_USAGE,
  type SparkShellFallbackInvocation,
} from "./sparkshell-parse"

export const SPARKSHELL_BIN_ENV = "OMO_SPARKSHELL_BIN"
export const LEGACY_SPARKSHELL_BIN_ENV = "OMX_SPARKSHELL_BIN"

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

type RuntimeEnv = Readonly<Record<string, string | undefined>>

export type SparkShellRunOptions = {
  readonly cwd?: string
  readonly env?: RuntimeEnv
  readonly platform?: NodeJS.Platform
  readonly spawn?: SparkShellSpawn
  readonly writeStdout?: (value: string) => void
  readonly writeStderr?: (value: string) => void
  readonly commandExists?: (command: string) => boolean
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

  writeStderr("[sparkshell] native sidecar unavailable; falling back to raw command execution without summary support.\n")
  const [command, ...commandArgs] = invocation.argv
  if (command === undefined) {
    writeStderr(`Missing command to run.\n${SPARKSHELL_USAGE}\n`)
    return 1
  }
  return runSpawnedCommand(spawn, command, commandArgs, { cwd, env }, writeStdout, writeStderr)
}

function resolveNativeBinaryOverride(env: RuntimeEnv, cwd: string): string {
  const override = env[SPARKSHELL_BIN_ENV]?.trim() || env[LEGACY_SPARKSHELL_BIN_ENV]?.trim() || ""
  if (override.length === 0) {
    return ""
  }
  return isAbsolute(override) || /^[A-Za-z]:[\\/]/.test(override) ? override : resolve(cwd, override)
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
