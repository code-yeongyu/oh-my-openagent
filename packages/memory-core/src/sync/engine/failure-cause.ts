// What a failed sync cycle tells a person, a harness or the desktop about its error (#13635): a closed
// set of safe fields, never the error's message, paths or anything else it carries. The raw error,
// stacks and cause chain included, goes to the local memory log only.

import { GitCommandError, GitError, GitNotFoundError, GitTimeoutError } from "../../git/errors"
import { SyncFormatError } from "../crypto/vendor/sync-format/jcs"
import { SyncCommitError } from "./adapters/git-sync-repo"
import { SyncHttpError } from "./adapters/http-transport"
import type { SyncLog } from "./ports"

/** The step of a cycle that threw. */
export type SyncStage = "load" | "resume" | "receive" | "capture" | "apply" | "push" | "finish"

export interface SyncFailureCause {
  /** One of the engine's own error classes or a built-in one, else "Error"; "NonError" for a thrown non-Error value. */
  readonly errorClass: string
  /** An errno code (`ENOSPC`), a service error code (`payload_too_large`) or a sync-format reason (`bad_integer`). */
  readonly code?: string
  readonly httpStatus?: number
  /** A failed git command's exit code. */
  readonly exitCode?: number
  readonly stage: SyncStage
}

// Matched by class, never by the error's own name: bundling renames classes, and foreign code may set any name.
const NAMED_CLASSES: ReadonlyArray<readonly [new (...args: never[]) => Error, string]> = [
  [SyncHttpError, "SyncHttpError"],
  [SyncCommitError, "SyncCommitError"],
  [SyncFormatError, "SyncFormatError"],
  [GitCommandError, "GitCommandError"],
  [GitTimeoutError, "GitTimeoutError"],
  [GitNotFoundError, "GitNotFoundError"],
  [GitError, "GitError"],
  [TypeError, "TypeError"],
  [RangeError, "RangeError"],
  [SyntaxError, "SyntaxError"],
  [ReferenceError, "ReferenceError"],
  [EvalError, "EvalError"],
  [URIError, "URIError"],
  [AggregateError, "AggregateError"],
]

const ERRNO_CODE = /^E[A-Z0-9_]{1,63}$/
const SERVICE_CODE = /^[a-z][a-z0-9_]{0,63}$/
/** How far down `cause` a code is looked for, and how many errors the log line holds. */
const CAUSE_DEPTH = 4

function errorClassOf(error: unknown): string {
  if (!(error instanceof Error)) return "NonError"
  const named = NAMED_CLASSES.find(([type]) => error instanceof type)
  return named === undefined ? "Error" : named[1]
}

function ownCode(error: Error): string | undefined {
  if (error instanceof SyncHttpError) return SERVICE_CODE.test(error.code) ? error.code : undefined
  if (error instanceof SyncFormatError) return SERVICE_CODE.test(error.reason) ? error.reason : undefined
  const code = "code" in error ? error.code : undefined
  return typeof code === "string" && ERRNO_CODE.test(code) ? code : undefined
}

/** The first code down the cause chain, so an fs error wrapped by a git or commit error still names itself. */
function codeOf(error: unknown): string | undefined {
  let current = error
  for (let depth = 0; depth < CAUSE_DEPTH && current instanceof Error; depth += 1) {
    const code = ownCode(current)
    if (code !== undefined) return code
    current = current.cause
  }
  return undefined
}

export function causeOf(error: unknown, stage: SyncStage): SyncFailureCause {
  const code = codeOf(error)
  return {
    errorClass: errorClassOf(error),
    ...(code === undefined ? {} : { code }),
    ...(error instanceof SyncHttpError ? { httpStatus: error.status } : {}),
    ...(error instanceof GitCommandError ? { exitCode: error.code } : {}),
    ...(error instanceof SyncCommitError && error.git !== undefined ? { exitCode: error.git.exitCode } : {}),
    stage,
  }
}

/** One thrown value as text, never throwing: a value with no usable string form (a null-prototype object) is named by its type. */
function printable(value: unknown): string {
  try {
    return value instanceof Error ? (value.stack ?? `${value.name}: ${value.message}`) : String(value)
  } catch {
    return `a thrown ${typeof value} with no string form`
  }
}

const GIT_SUBCOMMAND = /^[a-z][a-z0-9-]{0,31}$/

/**
 * A git error on a warning names its class, subcommand and exit code only: argv, stdout and stderr can hold
 * memory paths and file text. That covers the sync repo's own git failures (SyncCommitError, #13689) too.
 */
function printableAtWarn(value: unknown): string {
  if (value instanceof SyncCommitError) {
    if (value.git === undefined) return errorClassOf(value)
    return `${errorClassOf(value)}: git ${gitSubcommandOf(value) ?? "command"} exited ${value.git.exitCode}`
  }
  if (!(value instanceof GitError)) return printable(value)
  const exit = value instanceof GitCommandError ? ` exited ${value.code}` : ""
  return `${errorClassOf(value)}: git ${gitSubcommandOf(value) ?? "command"}${exit}`
}

/** The git subcommand a failed git step names on the warning, when the error is one; never a path or other argv text. */
export function gitSubcommandOf(value: unknown): string | undefined {
  if (value instanceof SyncCommitError)
    return value.git !== undefined && GIT_SUBCOMMAND.test(value.git.subcommand) ? value.git.subcommand : undefined
  if (!(value instanceof GitError)) return undefined
  const argv: unknown = "argv" in value ? value.argv : undefined
  return Array.isArray(argv)
    ? argv.find((arg): arg is string => typeof arg === "string" && GIT_SUBCOMMAND.test(arg))
    : undefined
}

/** The error down its cause chain, each one printed by `print`. */
function errorForLog(error: unknown, print: (value: unknown) => string): string {
  const parts: string[] = []
  let current = error
  for (let depth = 0; depth < CAUSE_DEPTH && current !== undefined; depth += 1) {
    parts.push(print(current))
    current = current instanceof Error ? current.cause : undefined
  }
  return parts.join("\ncaused by: ")
}

/**
 * Logs a failed cycle after the engine settled it, never throwing into the engine. A warning only when
 * the shown failure appeared or changed, so a cycle that keeps failing the same way does not repeat it;
 * the whole error, git detail included, is always at info.
 */
export function logCycleFailure(
  log: SyncLog | undefined,
  stage: SyncStage,
  error: unknown,
  shownChanged: boolean,
): void {
  try {
    const full = errorForLog(error, printable)
    if (shownChanged) {
      const brief = errorForLog(error, printableAtWarn)
      log?.(`sync cycle failed during ${stage}: ${brief}`, "warn")
      if (brief === full) return
    }
    log?.(`sync cycle failed during ${stage}: ${full}`)
  } catch {
    // A logger that throws has no channel left to report on; the status already carries the failure.
  }
}
