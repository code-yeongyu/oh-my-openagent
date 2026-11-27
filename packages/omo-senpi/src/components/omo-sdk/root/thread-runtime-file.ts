import type { ThreadCore } from "../../thread/sdk-core"
import type * as ThreadsRuntimeEntry from "../../thread/sdk-core/runtime-entry"
import type { OmoFailure } from "../contract"
import { OMO_CODE_REGISTRY } from "../contract/codes"
import { RUNTIME_STAMP } from "../runtime-stamp"
import { reportUnexpected, type UnexpectedPort, withUnexpectedLog } from "../unexpected-port"
import { ROOT_DISPOSED } from "./assemble"

// The SDK root's thread runtime file at its boundary (slice P1c, #15031): what the root takes from the file, the checks
// a loaded file passes before any member uses it, and the one path that loads it and builds the core.

/** What the root takes from its thread runtime file (slice P1c, #15031): functions and plain data only. */
export type ThreadsRuntime = Pick<
  typeof ThreadsRuntimeEntry,
  "RUNTIME_STAMP" | "createThreadCore" | "fail" | "threadToolParamSchemas"
>

export const RUNTIME_FILE_UNAVAILABLE = "runtime_file_unavailable"
export const RUNTIME_FILE_MISMATCH = "runtime_file_mismatch"

// A file that is missing loads on a later call once it is back; one whose evaluation failed stays failed for this process,
// because the platform's module loader keeps it (review 6075851574, MEDIUM 5), so the text names both recoveries.
const RUNTIME_FILE_MESSAGE =
  "A part of the omo SDK runtime could not be loaded. Reinstall or update the omo package, then retry; if it still fails, restart this process."

const MISMATCH_MESSAGE =
  "The omo SDK runtime installed on this device changed while this process was running. Restart the process to use it."

const CORE_MESSAGE = "The omo SDK thread core could not be started."

// A disposed root's thread call, up front or for a creation that resumes after dispose: the root's one shared refusal
// (design ruling; root/assemble.ts).
const DISPOSED: OmoFailure = { kind: "error", error: ROOT_DISPOSED }

// What the root takes from a loaded thread runtime file, checked once at the boundary (a file on disk is a system
// boundary; design lane ruling on review 6077124491): this build's stamp, the factory, the create call's fields and the
// author refusal. The call sites read only these checked values, so no member dereferences the file itself. The answer
// names the check that failed, never a value read from the file.
export type CheckedRuntime = {
  readonly createThreadCore: ThreadsRuntime["createThreadCore"]
  readonly createFields: readonly string[]
  readonly authorRefusal: ReturnType<ThreadsRuntime["fail"]>["error"]
}

function checkRuntime(loaded: unknown): CheckedRuntime | string {
  const file = (isPlainRecord(loaded) ? loaded : {}) as Readonly<Record<string, unknown>>
  if (file.RUNTIME_STAMP !== RUNTIME_STAMP) return "its build stamp is not this root's"
  if (typeof file.createThreadCore !== "function") return "it has no createThreadCore function"
  if (typeof file.fail !== "function") return "it has no fail function"
  if (!isPlainRecord(file.threadToolParamSchemas)) return "it has no threadToolParamSchemas object"
  const create = file.threadToolParamSchemas.thread_create
  if (!isPlainRecord(create) || !isPlainRecord(create.properties)) return "its thread_create schema has no properties"
  const refusal = (file.fail as ThreadsRuntime["fail"])(
    "invalid_arguments",
    "author is a connector's field.",
    "Send without author.",
  ) as unknown
  const error = isPlainRecord(refusal) ? refusal.error : undefined
  if (!isPlainRecord(error) || typeof error.code !== "string" || typeof error.message !== "string")
    return "its fail does not answer a failure"
  return {
    createThreadCore: file.createThreadCore as ThreadsRuntime["createThreadCore"],
    createFields: Object.keys(create.properties),
    authorRefusal: error as unknown as CheckedRuntime["authorRefusal"],
  }
}

// Every member of the core the root calls: the one table the core is checked against after construction, and (a test
// holds this) every core dereference in this file names an entry of it.
export const CORE_CALLS = [
  "list",
  "read",
  "send",
  "locate",
  "create",
  "interrupt",
  "close",
  "rename",
  "setModel",
  "release",
  "releaseRow",
  "warm",
  "dispose",
] as const satisfies readonly (keyof ThreadCore)[]

function coreMismatch(core: unknown): string | undefined {
  if (!isPlainRecord(core)) return "its core is not an object"
  const missing = CORE_CALLS.find((name) => typeof core[name] !== "function")
  if (missing !== undefined) return `its core has no ${missing} function`
  return undefined
}

const isPlainRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  (typeof value === "object" || typeof value === "function") && value !== null && !Array.isArray(value)

const importThreadsRuntime = (): Promise<ThreadsRuntime> => import("#omo-sdk-threads-runtime")

export const isFailure = (value: object): value is OmoFailure => (value as { readonly kind?: unknown }).kind === "error"

/**
 * The thread core of one threads namespace, reached on ONE path (review 6076881626, the design lane's ruling): `acquire`
 * loads the file, checks it, builds the core with `construct` and checks the core; the pending creation is assigned before
 * any await, so `dispose` waits for it and disposes what it built, and a creation that resumes after a dispose builds
 * nothing and answers the disposed refusal. A load, a check or a construction that fails is not kept; each answers
 * internal_error with fixed text, its exception at the logger port alone.
 */
export function threadCoreAccess(options: {
  readonly loadThreadsRuntime?: () => Promise<ThreadsRuntime>
  readonly onUnexpected?: UnexpectedPort
  readonly construct: (runtime: CheckedRuntime) => ThreadCore | Promise<ThreadCore>
  readonly disposePorts: () => Promise<void>
}) {
  let runtime: Promise<ThreadsRuntime> | undefined
  const refuse = (error: unknown, message: string, reason?: string): OmoFailure => {
    runtime = undefined
    const written = reportUnexpected(options.onUnexpected, error)
    return {
      kind: "error",
      error: {
        code: "internal_error",
        message: withUnexpectedLog(message, written),
        next_action: OMO_CODE_REGISTRY.internal_error.next_action,
        ...(reason === undefined ? {} : { details: { reason, file: "threads" } }),
      },
    }
  }
  const mismatched = (mismatch: string): OmoFailure =>
    refuse(
      new Error(`The thread runtime file does not match this root: ${mismatch}.`),
      MISMATCH_MESSAGE,
      RUNTIME_FILE_MISMATCH,
    )
  const loadRuntime = async (): Promise<CheckedRuntime | OmoFailure> => {
    let loaded: ThreadsRuntime
    try {
      loaded = await (runtime ??= (options.loadThreadsRuntime ?? importThreadsRuntime)())
    } catch (error) {
      return refuse(error, RUNTIME_FILE_MESSAGE, RUNTIME_FILE_UNAVAILABLE)
    }
    // Reading the file's exports is part of the boundary too: a getter or a fail that throws is a mismatch.
    let checked: CheckedRuntime | string
    try {
      checked = checkRuntime(loaded)
    } catch {
      checked = "reading its exports threw"
    }
    return typeof checked === "string" ? mismatched(checked) : checked
  }
  type Ready = { readonly runtime: CheckedRuntime; readonly core: ThreadCore }
  let disposed = false
  let pending: Promise<Ready | OmoFailure> | undefined
  const createCore = (): Promise<Ready | OmoFailure> => {
    if (pending !== undefined) return pending
    const creating: Promise<Ready | OmoFailure> = (async (): Promise<Ready | OmoFailure> => {
      const loaded = await loadRuntime()
      if (isFailure(loaded)) return loaded
      if (disposed) return DISPOSED
      try {
        const core = await options.construct(loaded)
        const mismatch = coreMismatch(core)
        return mismatch === undefined ? { runtime: loaded, core } : mismatched(mismatch)
      } catch (error) {
        return refuse(error, CORE_MESSAGE)
      }
    })().then((made) => {
      // A creation that fails after dispose() began answers the disposed refusal (its exception already reached the
      // logger port); a built core stays the pending result, so dispose releases it once and acquire refuses it.
      if (!isFailure(made)) return made
      if (disposed) return DISPOSED
      if (pending === creating) pending = undefined
      return made
    })
    pending = creating
    return creating
  }
  const acquire = (): Promise<Ready | OmoFailure> => (disposed ? Promise.resolve(DISPOSED) : createCore())
  // dispose() began at the root: from this step on no member reaches the core (the root's own mark, the same tick).
  const disposing = (): void => {
    disposed = true
  }
  const dispose = async (): Promise<void> => {
    disposed = true
    const made = pending === undefined ? undefined : await pending
    return made === undefined || isFailure(made) ? options.disposePorts() : made.core.dispose()
  }
  // The ONLY way a member reaches the core (review 6081652829 and the LEAD's ruling: dispose wins by construction): it
  // awaits the creation, then checks the disposed mark and calls `run` with the core in the same tick, with no await
  // between the check and the call. A member awaits anything else it needs (its input checks) BEFORE it calls `use`, and
  // `run` reaches the core before its own first await (a source check in threads-runtime-file.test.ts holds both).
  const use = async <R>(run: (core: ThreadCore) => Promise<R>): Promise<R | OmoFailure> => {
    const ready = await acquire()
    if (isFailure(ready)) return ready
    if (disposed) return DISPOSED
    return run(ready.core)
  }
  // The checked runtime values (no core) for a member that reads them before it calls `use`.
  const runtimeOf = async (): Promise<CheckedRuntime | OmoFailure> => {
    const ready = await acquire()
    return isFailure(ready) ? ready : ready.runtime
  }
  return { use, runtimeOf, disposing, dispose }
}
