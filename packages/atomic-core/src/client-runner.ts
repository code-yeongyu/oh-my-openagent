import { isAbsolute, win32 } from "node:path"

import { type AtomicCompatibility, parseAtomicCliDiagnostic } from "./contracts"
import { AtomicError } from "./errors"
import { ATOMIC_OUTPUT_LIMIT_BYTES, type AtomicSpawn, type AtomicSpawnOutcome } from "./process"

const ATOMIC_READ_TIMEOUT_MS = 5000
export const ATOMIC_VAULT_MUTATION_TIMEOUT_MS = 30_000

export type AtomicCallOptions = {
  readonly cwd: string
  readonly signal?: AbortSignal
}

export type AtomicCommand = {
  readonly operation: string
  readonly args: readonly string[]
  readonly mutation: boolean
  readonly timeoutMs?: number
  readonly outputLimitBytes?: number
  readonly stdin?: string
}

export type AtomicRunner = (command: AtomicCommand, call: AtomicCallOptions) => Promise<string>

export type AtomicRunnerOptions = {
  readonly executable: string
  readonly spawn: AtomicSpawn
  readonly environment: Readonly<Record<string, string>>
  readonly compatibility: Exclude<AtomicCompatibility, "unsupported">
}

type FailureContext = { readonly operation: string; readonly sideEffectsPossible: boolean }

function stdoutOrThrow(outcome: AtomicSpawnOutcome, context: FailureContext): string {
  switch (outcome.kind) {
    case "exited": {
      const diagnostic = parseAtomicCliDiagnostic(outcome.stderr)
      if (outcome.exitCode === 3) {
        throw new AtomicError("not_repository", { ...context, sideEffectsPossible: false, diagnostic: outcome.stderr })
      }
      if (outcome.exitCode !== 0 || diagnostic?.form === "usage") {
        const cliCode = diagnostic !== undefined && diagnostic.form !== "message" ? ` ${diagnostic.code}` : ""
        throw new AtomicError("command_failed", {
          ...context,
          message: `atomic ${context.operation} failed with exit ${outcome.exitCode}${cliCode}`,
          diagnostic: outcome.stderr,
        })
      }
      return outcome.stdout
    }
    case "spawn_failed":
      throw new AtomicError(outcome.errorCode === "ENOENT" ? "binary_missing" : "spawn_failed", {
        operation: context.operation,
        sideEffectsPossible: false,
        diagnostic: outcome.message,
      })
    case "timeout":
      throw new AtomicError("timeout", context)
    case "cancelled":
      throw new AtomicError("cancelled", context)
    case "output_limit":
      throw new AtomicError("output_limit", { ...context, diagnostic: `${outcome.stream} exceeded its byte limit` })
    case "signaled":
      throw new AtomicError("command_failed", { ...context, diagnostic: `terminated by ${outcome.signal}` })
    default: {
      const unreachable: never = outcome
      return unreachable
    }
  }
}

/** The single place an Atomic argv is executed. Mutations are refused unless the version is fully supported. */
export function createAtomicRunner(options: AtomicRunnerOptions): AtomicRunner {
  return async (command, call) => {
    if (command.mutation && options.compatibility !== "supported") {
      throw new AtomicError("version_unsupported", {
        operation: command.operation,
        sideEffectsPossible: false,
        message: `atomic ${command.operation} needs a supported 0.22.x release; this release is read-only`,
      })
    }
    const outcome = await options.spawn({
      executable: options.executable,
      args: command.args,
      cwd: call.cwd,
      environment: options.environment,
      stdin: command.stdin,
      timeoutMs: command.timeoutMs ?? ATOMIC_READ_TIMEOUT_MS,
      signal: call.signal,
      outputLimitBytes: command.outputLimitBytes ?? ATOMIC_OUTPUT_LIMIT_BYTES,
    })
    return stdoutOrThrow(outcome, { operation: command.operation, sideEffectsPossible: command.mutation })
  }
}

export function requireRepositoryRelativePath(path: string, operation: string): string {
  const segments = path.split(/[\\/]/)
  if (path.length === 0 || path.includes("\0") || isAbsolute(path) || win32.isAbsolute(path) || segments.includes("..")) {
    throw new AtomicError("unsafe_path", {
      operation,
      sideEffectsPossible: false,
      message: `atomic ${operation} needs a repository-relative path without '..' segments`,
    })
  }
  return path
}
