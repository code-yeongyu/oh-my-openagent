import type { GatewayStore } from "../../thread/gateway/store"
import type { ProvenanceWorkspaces } from "../../thread/gateway/provenance-resolver"
import type { RemoteThreadSurface } from "../../thread/remote/ports"
import type { ThreadCore } from "../../thread/sdk-core"
import type { ThreadHost } from "../../thread/tools/ports"
import type { Endpoint, OmoFailure, OmoPrincipal, RootCallKey } from "../contract"
import type * as result from "../contract/results/threads"
import { ROOT_DISPOSED } from "./assemble"
import { extensionFailure } from "./extension-codes"
import type { Members, NamespaceServing } from "./members"
import { notImplemented } from "./not-implemented"
import { onRoot, threadFailure } from "./thread-failures"

/** The thread options of design 4.1: the facade's own options of the same meaning. */
export type ThreadNamespaceOptions = {
  readonly provenanceWorkspaces?: ProvenanceWorkspaces
  readonly engineStatusAll?: () => Promise<string | undefined>
  readonly workerModuleUrl?: string | URL
  readonly firstPromptWaitMs?: number
}

export type ThreadPorts = {
  readonly host?: ThreadHost
  readonly store?: GatewayStore
  readonly remote?: RemoteThreadSurface
  readonly now?: () => number
}

type Input = Readonly<Record<string, unknown>>

// A field of the call's input schema the core does not act on yet is answered as not built, never silently dropped; a
// field outside the schema is left to the core, which refuses it by name as invalid_arguments (#14316).
async function unbuilt(key: RootCallKey, input: unknown, acted: readonly string[]): Promise<OmoFailure | undefined> {
  if (typeof input !== "object" || input === null) return undefined
  const { ROOT_CALLS } = await import("../contract/calls")
  const schema = Object.keys((ROOT_CALLS[key].input as { readonly properties?: object }).properties ?? {})
  const fields = Object.entries(input as Input)
    .filter(([field, value]) => value !== undefined && schema.includes(field) && !acted.includes(field))
    .map(([field]) => field)
  if (fields.length === 0) return undefined
  return {
    kind: "error",
    error: {
      code: "not_implemented",
      message: `${key} does not act on ${fields.join(", ")} in this release of the omo SDK.`,
      next_action: "Call it without those fields, or use the omo command that offers them.",
      details: { fields },
    },
  }
}

/** The root's module-URL check (design lane ruling): an absolute file URL. */
export const isAbsoluteFileUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "file:"
  } catch {
    return false
  }
}

// A store extension operation that throws (its store failed unexpectedly) answers internal_error with fixed text: the
// exception's own message and stack can carry what the store held, so they never reach the caller.
const EXTENSION_UNEXPECTED: OmoFailure = {
  kind: "error",
  error: {
    code: "internal_error",
    message: "The store extension operation failed unexpectedly.",
    next_action: "Call it again; if it fails again, run omo doctor.",
  },
}

// Thrown by the core accessor once dispose() began; every member answers it as ROOT_DISPOSED, so no catch below
// may turn it into its own answer.
const CORE_NOT_CREATED = new Error("root_disposed")

async function settledExtension<T>(run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run()
  } catch (error) {
    if (error === CORE_NOT_CREATED) throw error
    return undefined
  }
}

const LIST = ["all_scope", "state"]
const READ = ["thread", "max_bytes", "cursor", "all_scope"]
const SEND = ["thread", "message", "delivery", "expected_turn_id", "all_scope", "idempotency_key", "collapse_key"]
// The thread core and its contracts are imported on the first thread call, not when the entry loads (design lane ruling on
// the runtime's cold import): a script that only signs in never evaluates them.
const createFields = async (): Promise<readonly string[]> =>
  Object.keys((await import("../../thread/contracts")).threadToolParamSchemas.thread_create.properties)

const env = (options: {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly endpoint?: Endpoint
}) => ({
  ...options.env,
  ...(options.endpoint?.socket === undefined ? {} : { SENPI_RPC_SOCKET: options.endpoint.socket }),
  ...(options.endpoint?.key_root === undefined ? {} : { SENPI_RPC_KEY_ROOT: options.endpoint.key_root }),
})

/** The threads namespace over the thread core, created on the first call; dispose releases its store and sessions. */
export function threadsNamespace(options: {
  readonly agentDir: string
  readonly cwd: string
  readonly uid: number
  readonly user: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly principal: OmoPrincipal
  readonly endpoint?: Endpoint
  readonly threads?: ThreadNamespaceOptions
  readonly ports?: ThreadPorts
  /** The public root refuses a module URL that is not an absolute file URL before any effect; the shipped facade does not. */
  readonly checkModuleUrl?: boolean
}): NamespaceServing & { readonly releaseLocated: ThreadCore["releaseRow"] } {
  // Only a script or a person reaches the thread core through the root; every allowed cell of another principal is
  // slice T2's or X1b's (design lane ruling), and the refused cells are answered before this at the root's boundary.
  if (options.principal.kind !== "script" && options.principal.kind !== "person")
    return { members: {}, releaseLocated: async () => ({ success: false, error: "sender_not_allowed" }) }
  // The core is created only while the namespace is open: the pending creation is assigned before any await, so a
  // dispose() that begins later awaits it and disposes what it built, and a call that arrives after dispose() builds
  // nothing (review comment 7202063494).
  let disposed = false
  let core: Promise<ThreadCore> | undefined
  const thread = (): Promise<ThreadCore> => {
    if (disposed && core === undefined) return Promise.reject(CORE_NOT_CREATED)
    return (core ??= import("../../thread/sdk-core").then(({ createThreadCore }) =>
      createThreadCore({
        agentDir: options.agentDir,
        cwd: options.cwd,
        uid: options.uid,
        user: options.user,
        env: env(options),
        ...options.threads,
        ...options.ports,
      }),
    ))
  }
  const members: Members = {
    "threads.list": async (input = {}) =>
      (await unbuilt("threads.list", input, LIST)) ??
      onRoot((await (await thread()).list(input)) as result.ThreadListResult),
    "threads.read": async (input) =>
      (await unbuilt("threads.read", input, READ)) ??
      onRoot((await (await thread()).read(input)) as result.ThreadReadResult),
    "threads.send": async (input) => {
      if (input?.author !== undefined)
        return threadFailure(
          (await import("../../thread/sdk-core/failures")).fail(
            "invalid_arguments",
            "author is a connector's field.",
            "Send without author.",
          ).error,
        )
      return (await unbuilt("threads.send", input, SEND)) ?? onRoot(await (await thread()).send(input))
    },
    "threads.locate": async (input) => {
      const located = await (await thread()).locate(input)
      if (located.kind === "error") return threadFailure(located.error)
      return { kind: "ok", thread: located.thread.address ?? located.thread.thread_id, located: located.thread }
    },
    "threads.create": async (input) => {
      if (typeof input?.prompt === "object") return notImplemented("threads.create")() as Promise<OmoFailure>
      return (
        (await unbuilt("threads.create", input, await createFields())) ??
        onRoot(
          (await (await thread()).create(input as Parameters<ThreadCore["create"]>[0])) as result.ThreadCreateResult,
        )
      )
    },
    "threads.interrupt": async (input) =>
      onRoot((await (await thread()).interrupt(input)) as result.ThreadInterruptResult),
    "threads.close": async (input = {}) => onRoot((await (await thread()).close(input)) as result.ThreadCloseResult),
    "threads.rename": async (input = {}) => onRoot((await (await thread()).rename(input)) as result.ThreadRenameResult),
    "threads.setModel": async (input) =>
      onRoot((await (await thread()).setModel(input)) as result.ThreadSetModelResult),
    "threads.release": async (input) => {
      const refused = await unbuilt("threads.release", input, ["thread", "interrupt", "force"])
      if (refused !== undefined) return refused
      const released = onRoot(await (await thread()).release(input))
      // Design lane ruling: the root's failures are refusals; the engine's release_unsupported reply (a row with no
      // local endpoint) is answered as one. The thread facade keeps the engine's shape through its own path.
      if (released.kind === "ok" && !released.value.success && released.value.error === "release_unsupported")
        return {
          kind: "error",
          error: {
            code: "unsupported",
            message: `The thread ${input.thread} has no endpoint on this device that can release it.`,
            next_action: "Release it on the device that serves it.",
            details: { reason: "release_unsupported" },
          },
        }
      return released
    },
    "threads.extensions.register": async (input) => {
      if (options.checkModuleUrl !== false && !isAbsoluteFileUrl(input.moduleUrl))
        return {
          kind: "error",
          error: {
            code: "invalid_arguments",
            message: "moduleUrl must be an absolute file URL of compiled JavaScript.",
            next_action: "Pass a file:// URL to the extension's built module.",
            details: { field: "moduleUrl" },
          },
        }
      const registered = await settledExtension(async () => (await thread()).extensions.register(input))
      if (registered === undefined) return EXTENSION_UNEXPECTED
      return registered.kind === "ok" ? registered : extensionFailure(registered)
    },
    "threads.extensions.call": async (input) => {
      const answered = await settledExtension(async () =>
        (await thread()).extensions.call(input.name, input.op, input.args),
      )
      if (answered === undefined) return EXTENSION_UNEXPECTED
      return answered.kind === "ok" ? answered : extensionFailure(answered)
    },
    "daemon.warm": async (input = {}) => {
      const refused = await unbuilt("daemon.warm", input, [])
      if (refused !== undefined) return refused
      try {
        return { kind: "ok", value: await (await thread()).warm() }
      } catch (error) {
        if (error === CORE_NOT_CREATED) throw error
        // The warm's own transport error, as `omo daemon run` prints it today; slice C1a words it as the daemon core's.
        const message = error instanceof Error ? error.message : String(error)
        return { kind: "error", error: { code: "internal_error", message, next_action: "Run omo daemon run again." } }
      }
    },
  }
  // A member that reaches for the core after dispose() began answers the disposed refusal instead of building one.
  const open = Object.fromEntries(
    Object.entries(members).map(([key, member]) => [
      key,
      async (...args: unknown[]) => {
        try {
          return await (member as (...a: unknown[]) => Promise<unknown>)(...args)
        } catch (error) {
          if (error === CORE_NOT_CREATED) return { kind: "error", error: ROOT_DISPOSED }
          throw error
        }
      },
    ]),
  ) as Members
  // The caller's remote sessions and store are the root's to release even when no thread call ever built the core.
  const disposePorts = async (): Promise<void> => {
    await options.ports?.remote?.sessions.close?.().catch(() => undefined)
    await options.ports?.store?.dispose()
  }
  return {
    members: open,
    // The thread facade's release (design lane ruling on threads.release): the row its caller located, released where
    // that row is served, with no second lookup. Reachable only through the internal assembly, never the public root.
    releaseLocated: async (located, request) => (await thread()).releaseRow(located, request),
    dispose: async () => {
      disposed = true
      if (core === undefined) return disposePorts()
      await (await core).dispose()
    },
  }
}
