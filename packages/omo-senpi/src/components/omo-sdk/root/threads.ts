import type { GatewayStore } from "../../thread/gateway/store"
import type { ProvenanceWorkspaces } from "../../thread/gateway/provenance-resolver"
import type { DeviceRow } from "../../remote/types"
import { projectedCandidates } from "./refusal-candidates"
import type { RemoteThreadSurface } from "../../thread/remote/ports"
import type { ThreadCore } from "../../thread/sdk-core"
import type { ThreadHost } from "../../thread/tools/ports"
import type { Endpoint, OmoFailure, OmoPrincipal, RootCallKey } from "../contract"
import type * as result from "../contract/results/threads"
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

async function settledExtension<T>(run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run()
  } catch {
    return undefined
  }
}

// With no account surface there is no listing to read the row from: answered with the code the remote client's resolve
// answers when this device is signed out (remote/codes.ts: signed_out is host_unavailable).
const NO_ACCOUNT: OmoFailure = {
  kind: "error",
  error: {
    code: "host_unavailable",
    message: "This device reaches no omo account, so no account listing holds the thread's row.",
    next_action: "Sign in (omo login), then retry.",
  },
}

// A session's answer never carries an unexpected exception's text (the B8 echo of the thread core's thrown(), admitted
// only for a script and a person until slice T1b removes it): internal_error is answered with fixed text.
/** The fixed answer for an unexpected exception (security ruling B8): no exception text in any field. */
const UNEXPECTED: OmoFailure = {
  kind: "error",
  error: {
    code: "internal_error",
    message: "The thread operation failed unexpectedly.",
    next_action: "Call it again; if it fails again, report the call and the time it failed.",
  },
}

const sessionFailure = (error: Parameters<typeof threadFailure>[0]): OmoFailure =>
  error.code === "internal_error" ? UNEXPECTED : threadFailure(error)

/** devices.resolve over the remote client's roster (the address core's resolver); the row as it lists it. */
async function resolveDevice(
  remote: RemoteThreadSurface | undefined,
  device: string,
): Promise<OmoFailure | { readonly kind: "ok"; readonly value: DeviceRow }> {
  if (remote === undefined) return NO_ACCOUNT
  try {
    const resolved = await remote.client.devices.resolve(device)
    if (resolved.kind === "error") return (await import("./remote-failures")).remoteFailure(resolved)
    return { kind: "ok", value: resolved.value }
  } catch {
    return UNEXPECTED
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
  let core: Promise<ThreadCore> | undefined
  // The caller's remote sessions and store are the root's to release even when no thread call ever built the core.
  const disposePorts = async (): Promise<void> => {
    await options.ports?.remote?.sessions.close?.().catch(() => undefined)
    await options.ports?.store?.dispose()
  }
  const thread = (): Promise<ThreadCore> =>
    (core ??= import("../../thread/sdk-core").then(({ createThreadCore }) =>
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
  // A session reaches the resolution calls only, projected to what the owner decided (security design 4.6, revision 22):
  // identifiers for resolve, the located thread without its endpoint and session file path for locate. Every other
  // allowed cell of a session or another principal is slice T2's or X1b's (design lane ruling), and the refused cells are
  // answered before this at the root's boundary.
  // Ruling B (the owner's, T1a review LOW 1): a resolution call's refusal candidates are the caller's own list rows for
  // the same threads under the call's scope, plus the preview of a row it may read.
  const candidateRefusal = (failure: OmoFailure, allScope?: boolean) =>
    projectedCandidates(failure, async () => {
      const listed = await (await thread()).list(allScope === true ? { all_scope: true } : {})
      const rows = Reflect.get(Object(listed), "threads")
      return Array.isArray(rows) ? rows : []
    })
  if (options.principal.kind === "session") {
    const caller = { kind: "session", id: options.principal.session_id } as const
    return {
      members: {
        "threads.resolve": async (input) => {
          const decided = await (await thread()).resolveThread(input, caller)
          if (decided.kind === "error") return await candidateRefusal(sessionFailure(decided.error), input.all_scope)
          return { kind: "ok", thread: decided.thread, id: decided.id, device: decided.device }
        },
        "threads.locate": async (input) => {
          const located = await (await thread()).locate(input, caller)
          if (located.kind === "error") return await candidateRefusal(sessionFailure(located.error), input.all_scope)
          const { endpoint: _endpoint, session_path: _path, ...shown } = located.thread
          return { kind: "ok", thread: shown.address ?? shown.thread_id, located: shown }
        },
        "devices.resolve": async (input) => {
          const resolved = await resolveDevice(options.ports?.remote, input.device)
          return resolved.kind === "error"
            ? await candidateRefusal(resolved)
            : { kind: "ok", value: { id: resolved.value.id } }
        },
      },
      releaseLocated: async () => ({ success: false, error: "sender_not_allowed" }),
      dispose: async () => (core === undefined ? disposePorts() : (await core).dispose()),
    }
  }
  if (options.principal.kind !== "script" && options.principal.kind !== "person")
    return { members: {}, releaseLocated: async () => ({ success: false, error: "sender_not_allowed" }) }
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
      if (located.kind === "error") return await candidateRefusal(threadFailure(located.error), input.all_scope)
      return { kind: "ok", thread: located.thread.address ?? located.thread.thread_id, located: located.thread }
    },
    "devices.resolve": async (input) => {
      const resolved = await resolveDevice(options.ports?.remote, input.device)
      return resolved.kind === "error" ? await candidateRefusal(resolved) : resolved
    },
    "threads.resolve": async (input) => {
      const decided = await (await thread()).resolveThread(input)
      if (decided.kind === "error") return await candidateRefusal(threadFailure(decided.error), input.all_scope)
      const remote = options.ports?.remote
      if (remote === undefined) return NO_ACCOUNT
      // Design lane ruling A: the row is the account listing's row for the id the one resolver decided, read by that id.
      const listed = await remote.client.sessions.list(decided.device === null ? undefined : { device: decided.device })
      if (listed.kind === "error") return (await import("./remote-failures")).remoteFailure(listed)
      const session = listed.value.rows.find(
        (row) =>
          (decided.device === null ? row.device.self === true : row.device.id === decided.device) &&
          (row.thread === decided.thread || (decided.id !== "" && row.durable_id === decided.id)),
      )
      if (session === undefined)
        return {
          kind: "error",
          error: {
            code: "not_found",
            message: `${decided.thread} is not in the account's listing of its device.`,
            next_action: "Run omo thread list --all-scope.",
            details: { thread: decided.thread },
          },
        }
      return { kind: "ok", thread: decided.thread, session, device: session.device.id }
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
        // The warm's own transport error, as `omo daemon run` prints it today; slice C1a words it as the daemon core's.
        const message = error instanceof Error ? error.message : String(error)
        return { kind: "error", error: { code: "internal_error", message, next_action: "Run omo daemon run again." } }
      }
    },
  }
  return {
    members,
    // The thread facade's release (design lane ruling on threads.release): the row its caller located, released where
    // that row is served, with no second lookup. Reachable only through the internal assembly, never the public root.
    releaseLocated: async (located, request) => (await thread()).releaseRow(located, request),
    dispose: async () => (core === undefined ? disposePorts() : (await core).dispose()),
  }
}
