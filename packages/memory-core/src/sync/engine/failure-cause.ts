// What a failed sync cycle tells a person, a harness or the desktop about its error (#13635): a closed
// set of safe fields, never the error's message, paths or anything else it carries. The raw error,
// stacks and cause chain included, goes to the local memory log only.

import { GitCommandError, GitError, GitNotFoundError, GitTimeoutError } from "../../git/errors"
import { SyncFormatError } from "../crypto/vendor/sync-format/jcs"
import { SyncCommitError } from "./adapters/git-sync-repo"
import { SyncHttpError } from "./adapters/http-transport"

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

/** The whole error for the local memory log: every stack down the cause chain. */
function errorForLog(error: unknown): string {
  const parts: string[] = []
  let current = error
  for (let depth = 0; depth < CAUSE_DEPTH && current !== undefined; depth += 1) {
    parts.push(printable(current))
    current = current instanceof Error ? current.cause : undefined
  }
  return parts.join("\ncaused by: ")
}

/** Logs a failed cycle with its whole error, after the engine settled it; it never throws into the engine. */
export function logCycleFailure(log: ((line: string) => void) | undefined, stage: SyncStage, error: unknown): void {
  try {
    log?.(`sync cycle failed during ${stage}: ${errorForLog(error)}`)
  } catch {
    // A logger that throws has no channel left to report on; the status already carries the failure.
  }
}
