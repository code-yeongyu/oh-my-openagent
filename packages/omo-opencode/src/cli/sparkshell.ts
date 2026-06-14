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
  hasTopLevelSparkShellJsonFlag,
  parseSparkShellFallbackInvocation,
  parseTopLevelSparkShellBudget,
  SPARKSHELL_USAGE,
  stripTopLevelSparkShellArgs,
  type SparkShellFallbackInvocation,
} from "./sparkshell-parse"
import { condenseOutput, extractContextHints } from "./sparkshell-condense"
import { loadCodexSessionContextDetails, type SessionContextDetails } from "./sparkshell-session-context"
import {
  createDefaultSparkSummarizer,
  isSparkSummaryEnabled,
  resolveSparkModel,
  SPARKSHELL_SPARK_ENV,
  type SparkSummarizer,
  type SparkSummaryRequest,
} from "./sparkshell-spark"

export const SPARKSHELL_BIN_ENV = "OMO_SPARKSHELL_BIN"
export const SPARKSHELL_CONDENSE_ENV = "OMO_SPARKSHELL_CONDENSE"
export const SPARKSHELL_CONDENSE_BUDGET_ENV = "OMO_SPARKSHELL_CONDENSE_BUDGET"

const DEFAULT_CONDENSE_BUDGET_CHARS = 20_000

export type { SparkShellAppServerClient, SparkShellAppServerCommand, SparkShellAppServerResult }

export {
  parseSparkShellFallbackInvocation,
  parseTopLevelSparkShellBudget,
  resolveFallbackShellArgv,
  SPARKSHELL_USAGE,
} from "./sparkshell-parse"

export {
  DEFAULT_SPARK_MODEL,
  SPARKSHELL_SPARK_BIN_ENV,
  SPARKSHELL_SPARK_ENV,
  SPARKSHELL_SPARK_MODEL_ENV,
  SPARKSHELL_SPARK_TIMEOUT_ENV,
  type SparkSummarizer,
  type SparkSummaryRequest,
} from "./sparkshell-spark"

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
  readonly loadSessionContext?: (env: RuntimeEnv) => SessionContextDetails | null
  readonly sparkSummarize?: SparkSummarizer | null
}

type SparkShellExecOutcome = {
  readonly code: number
  readonly executed: boolean
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

  const jsonMode = hasTopLevelSparkShellJsonFlag(args)
  const getDetails = createLazySessionDetails(env, options.loadSessionContext)
  const transformOutput = jsonMode
    ? undefined
    : createCondenseTransform(args, env, getDetails, resolveSparkSummarizer(options.sparkSummarize, env, cwd))
  const outcome = await executeSparkShell(args, options, { cwd, env, writeStdout, writeStderr, transformOutput })
  if (outcome.executed && !jsonMode) {
    const block = getDetails()?.block ?? ""
    if (block.length > 0) {
      writeStdout(`\n${block}\n`)
    }
  }
  return outcome.code
}

function createLazySessionDetails(
  env: RuntimeEnv,
  load: ((env: RuntimeEnv) => SessionContextDetails | null) | undefined,
): () => SessionContextDetails | null {
  const loadDetails = load ?? loadCodexSessionContextDetails
  let loaded = false
  let details: SessionContextDetails | null = null
  return () => {
    if (!loaded) {
      loaded = true
      try {
        details = loadDetails(env)
      } catch {
        details = null
      }
    }
    return details
  }
}

function createCondenseTransform(
  args: readonly string[],
  env: RuntimeEnv,
  getDetails: () => SessionContextDetails | null,
  sparkSummarize: SparkSummarizer | null,
): ((text: string) => string) | undefined {
  if (isFalsyEnvValue(env[SPARKSHELL_CONDENSE_ENV])) {
    return undefined
  }
  const budget = parseTopLevelSparkShellBudget(args) ?? parseEnvBudget(env) ?? DEFAULT_CONDENSE_BUDGET_CHARS
  const commandLine = stripTopLevelSparkShellArgs(args).join(" ")
  return (text: string): string => {
    if (text.length <= budget) {
      return text
    }
    const details = getDetails()
    if (sparkSummarize) {
      const summary = summarizeWithSpark(sparkSummarize, {
        commandLine,
        text,
        budgetChars: budget,
        sessionContext: details?.block ?? "",
      })
      if (summary !== null) {
        return formatSparkSummary(summary, resolveSparkModel(env), text)
      }
    }
    const hints = details === null ? [] : extractContextHints([details.firstUserRequest, details.latestUserRequest])
    return condenseOutput(text, { budgetChars: budget, hints }).output
  }
}

function resolveSparkSummarizer(
  option: SparkSummarizer | null | undefined,
  env: RuntimeEnv,
  cwd: string,
): SparkSummarizer | null {
  if (!isSparkSummaryEnabled(env)) {
    return null
  }
  if (option !== undefined) {
    return option
  }
  return createDefaultSparkSummarizer(env, cwd)
}

function summarizeWithSpark(sparkSummarize: SparkSummarizer, request: SparkSummaryRequest): string | null {
  try {
    const summary = sparkSummarize(request)
    return summary !== null && summary.trim().length > 0 ? summary : null
  } catch {
    return null
  }
}

function formatSparkSummary(summary: string, model: string, originalText: string): string {
  const totalLines = originalText.split("\n").length
  const header = [
    `[sparkshell] spark summary (model: ${model}; original output: ${totalLines} lines, ${originalText.length} chars);`,
    `as-is excerpt with a bottom [sparkshell caption]. Set ${SPARKSHELL_SPARK_ENV}=0 to disable.`,
  ].join(" ")
  return `${header}\n${summary.trim()}\n`
}

function parseEnvBudget(env: RuntimeEnv): number | null {
  const parsed = Number.parseInt(env[SPARKSHELL_CONDENSE_BUDGET_ENV]?.trim() ?? "", 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.max(2000, parsed) : null
}

function isFalsyEnvValue(value: string | undefined): boolean {
  if (value === undefined) {
    return false
  }
  return ["0", "false", "no", "off"].includes(value.trim().toLowerCase())
}

async function executeSparkShell(
  args: readonly string[],
  options: SparkShellRunOptions,
  context: {
    readonly cwd: string
    readonly env: RuntimeEnv
    readonly writeStdout: (value: string) => void
    readonly writeStderr: (value: string) => void
    readonly transformOutput?: (text: string) => string
  },
): Promise<SparkShellExecOutcome> {
  const { cwd, env, writeStdout, writeStderr, transformOutput } = context
  const nativeBinaryPath = resolveNativeBinaryOverride(env, cwd)
  const spawn = options.spawn ?? defaultSpawn
  if (nativeBinaryPath.length > 0) {
    return { code: runSpawnedCommand(spawn, nativeBinaryPath, args, { cwd, env }, writeStdout, writeStderr), executed: true }
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
        transformOutput,
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
    return { code: 1, executed: false }
  }

  const [command, ...commandArgs] = invocation.argv
  if (command === undefined) {
    writeStderr(`Missing command to run.\n${SPARKSHELL_USAGE}\n`)
    return { code: 1, executed: false }
  }
  return { code: runSpawnedCommand(spawn, command, commandArgs, { cwd, env }, writeStdout, writeStderr, transformOutput), executed: true }
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
    readonly transformOutput?: (text: string) => string
  },
): Promise<SparkShellExecOutcome> {
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
    return { code: 1, executed: false }
  }

  if (invocation.kind === "tmux-pane") {
    const [command, ...commandArgs] = invocation.argv
    if (command === undefined) {
      options.writeStderr(`Missing command to run.\n${SPARKSHELL_USAGE}\n`)
      return { code: 1, executed: false }
    }
    return {
      code: runSpawnedCommand(
        options.spawn,
        command,
        commandArgs,
        { cwd: options.cwd, env: options.env },
        options.writeStdout,
        options.writeStderr,
        options.transformOutput,
      ),
      executed: true,
    }
  }

  const result = await appServerClient.exec({
    argv: invocation.argv,
    cwd: options.cwd,
    env: options.env,
  })
  if (result.stdout.length > 0) {
    options.writeStdout(options.transformOutput ? options.transformOutput(result.stdout) : result.stdout)
  }
  if (result.stderr.length > 0) {
    options.writeStderr(options.transformOutput ? options.transformOutput(result.stderr) : result.stderr)
  }
  return { code: result.exitCode, executed: true }
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
  transformOutput?: (text: string) => string,
): number {
  const result = spawn(command, args, options)
  if (result.stdout && result.stdout.length > 0) {
    writeStdout(transformOutput ? transformOutput(result.stdout) : result.stdout)
  }
  if (result.stderr && result.stderr.length > 0) {
    writeStderr(transformOutput ? transformOutput(result.stderr) : result.stderr)
  }
  if (result.error) {
    if (isCaptureOverflowError(result.error)) {
      writeStderr(
        `[sparkshell] ${command} exceeded the 64MB output capture limit; the command was terminated and truncated output is shown above. Pipe to a file or narrow the command instead.\n`,
      )
      return 1
    }
    writeStderr(`[sparkshell] failed to launch ${command}: ${result.error.message}\n`)
    if (isSpawnNotFoundError(result.error) && hasShellMetacharacters(command)) {
      writeStderr(
        `[sparkshell] '${command}' looks like a shell command; re-run with: omo sparkshell --shell '${command}'\n`,
      )
    }
    return 1
  }
  if (typeof result.status === "number") {
    return result.status
  }
  return signalExitCode(result.signal)
}

function isCaptureOverflowError(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOBUFS"
}

function isSpawnNotFoundError(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT"
}

const SHELL_METACHARACTER_PATTERN = /(\s&&\s|\s\|\|\s|[|;<>]|\$\(|`)/

function hasShellMetacharacters(command: string): boolean {
  return SHELL_METACHARACTER_PATTERN.test(command)
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
    stdio: ["inherit", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdout: typeof result.stdout === "string" ? result.stdout : undefined,
    stderr: typeof result.stderr === "string" ? result.stderr : undefined,
  }
}
