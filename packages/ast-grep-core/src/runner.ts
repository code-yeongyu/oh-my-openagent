import { DEFAULT_TIMEOUT_MS } from "./language-support"
import { createSgResultFromStdout } from "./sg-compact-json-output"
import type { CliLanguage, SgResult } from "./types"

const SG_BINARY_NOT_FOUND_MESSAGE =
  `ast-grep (sg) binary not found.\n\n` +
  `Install options:\n` +
  `  bun add -D @ast-grep/cli\n` +
  `  cargo install ast-grep --locked\n` +
  `  brew install ast-grep`

export interface SgRunArgs {
  readonly pattern: string
  readonly lang: CliLanguage
  readonly cwd?: string
  readonly paths?: readonly string[]
  readonly globs?: readonly string[]
  readonly rewrite?: string
  readonly context?: number
  readonly updateAll?: boolean
}

export interface SpawnOptions {
  readonly cwd?: string
  readonly stdout?: "pipe" | "inherit" | "ignore"
  readonly stderr?: "pipe" | "inherit" | "ignore"
}

export interface SpawnResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export type SpawnProcess = (
  binary: string,
  args: readonly string[],
  options?: SpawnOptions,
) => Promise<SpawnResult>

export interface SgRunnerDeps {
  readonly resolveBinary: () => Promise<string>
  readonly spawnProcess: SpawnProcess
}

export function buildSgArgs(
  options: SgRunArgs,
  flags: { readonly includeJson: boolean; readonly includeUpdateAll: boolean },
): string[] {
  const args = ["run", "-p", options.pattern, "--lang", options.lang]

  if (flags.includeJson) {
    args.push("--json=compact")
  }

  if (options.rewrite) {
    args.push("-r", options.rewrite)
    if (flags.includeUpdateAll) {
      args.push("--update-all")
    }
  }

  if (typeof options.context === "number" && options.context > 0) {
    args.push("-C", String(options.context))
  }

  if (options.globs) {
    for (const glob of options.globs) {
      args.push("--globs", glob)
    }
  }

  const paths = options.paths && options.paths.length > 0 ? options.paths : ["."]
  args.push("--", ...paths)
  return args
}

export async function runSg(options: SgRunArgs, deps: SgRunnerDeps): Promise<SgResult> {
  const shouldSeparateWritePass = Boolean(options.rewrite && options.updateAll)
  const args = buildSgArgs(options, { includeJson: true, includeUpdateAll: false })

  let binary: string
  try {
    binary = await deps.resolveBinary()
  } catch (error) {
    return {
      matches: [],
      totalMatches: 0,
      truncated: false,
      error: isNoEntryError(error) ? SG_BINARY_NOT_FOUND_MESSAGE : `Failed to resolve ast-grep binary: ${errorMessage(error)}`,
    }
  }

  const searchResult = await trySpawn(binary, args, options.cwd, deps)
  if (searchResult.error) {
    return searchResult.error
  }

  const output = searchResult.value
  if (output.exitCode !== 0 && output.stdout.trim() === "") {
    if (output.stderr.includes("No files found")) {
      return { matches: [], totalMatches: 0, truncated: false }
    }
    if (output.stderr.trim()) {
      return { matches: [], totalMatches: 0, truncated: false, error: output.stderr.trim() }
    }
    return { matches: [], totalMatches: 0, truncated: false }
  }

  const jsonResult = createSgResultFromStdout(output.stdout)
  if (!(shouldSeparateWritePass && jsonResult.matches.length > 0)) {
    return jsonResult
  }

  const writeArgs = buildSgArgs(options, { includeJson: false, includeUpdateAll: true })
  const writeResult = await trySpawn(binary, writeArgs, options.cwd, deps)
  if (writeResult.error) {
    return { ...jsonResult, error: `Replace failed: ${writeResult.error.error ?? "unknown error"}` }
  }

  if (writeResult.value.exitCode !== 0) {
    const errorDetail =
      writeResult.value.stderr.trim() || `ast-grep exited with code ${writeResult.value.exitCode}`
    return { ...jsonResult, error: `Replace failed: ${errorDetail}` }
  }

  return jsonResult
}

async function trySpawn(
  binary: string,
  args: readonly string[],
  cwd: string | undefined,
  deps: SgRunnerDeps,
): Promise<{ readonly value: SpawnResult; readonly error?: never } | { readonly value?: never; readonly error: SgResult }> {
  try {
    const value = await deps.spawnProcess(binary, args, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    })
    return { value }
  } catch (error) {
    if (error instanceof Error && error.message.includes("timeout")) {
      return {
        error: {
          matches: [],
          totalMatches: 0,
          truncated: true,
          truncatedReason: "timeout",
          error: error.message,
        },
      }
    }

    if (isNoEntryError(error)) {
      return {
        error: {
          matches: [],
          totalMatches: 0,
          truncated: false,
          error: SG_BINARY_NOT_FOUND_MESSAGE,
        },
      }
    }

    return {
      error: {
        matches: [],
        totalMatches: 0,
        truncated: false,
        error: `Failed to spawn ast-grep: ${errorMessage(error)}`,
      },
    }
  }
}

function isNoEntryError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false
  }

  const code = Reflect.get(error, "code")
  const message = errorMessage(error)
  return code === "ENOENT" || message.includes("ENOENT") || message.includes("not found")
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export { DEFAULT_TIMEOUT_MS }
