import { threadToolParamSchemas } from "../../thread/contracts"
import type { GatewayStore } from "../../thread/gateway/store"
import type { ProvenanceWorkspaces } from "../../thread/gateway/provenance-resolver"
import type { RemoteThreadSurface } from "../../thread/remote/ports"
import { createThreadCore, type ThreadCore } from "../../thread/sdk-core"
import { fail } from "../../thread/sdk-core/failures"
import type { ThreadHost } from "../../thread/tools/ports"
import type { Endpoint, OmoFailure, OmoPrincipal, RootCallKey } from "../contract"
import type * as result from "../contract/results/threads"
import { ROOT_CALLS } from "../contract/calls"
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
  /**
   * Where an unexpected exception goes (security ruling B8): its message and stack reach this port only, never an answer,
   * a stream event or a log line the caller sees. Absent, nothing is written (the CLI's standard error is an output too).
   * A port that wrote the details to a local file answers that file's path, and the fixed message names it.
   */
  readonly onUnexpected?: (error: unknown) => unknown
}

type Input = Readonly<Record<string, unknown>>

// A field of the call's input schema the core does not act on yet is answered as not built, never silently dropped; a
// field outside the schema is left to the core, which refuses it by name as invalid_arguments (#14316).
function unbuilt(key: RootCallKey, input: unknown, acted: readonly string[]): OmoFailure | undefined {
  if (typeof input !== "object" || input === null) return undefined
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

const isAbsoluteFileUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "file:"
  } catch {
    return false
  }
}

const LIST = ["all_scope", "state", "workspace", "device", "project", "name", "archived", "idempotency_key"]
const READ = ["thread", "max_bytes", "cursor", "all_scope", "limit", "idempotency_key"]
const SEND = ["thread", "message", "delivery", "expected_turn_id", "all_scope", "idempotency_key", "collapse_key"]
const CREATE = Object.keys(threadToolParamSchemas.thread_create.properties)

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
  let core: ThreadCore | undefined
  const thread = (): ThreadCore =>
    (core ??= createThreadCore({
      agentDir: options.agentDir,
      cwd: options.cwd,
      uid: options.uid,
      user: options.user,
      env: env(options),
      ...options.threads,
      ...options.ports,
    }))
  const members: Members = {
    "threads.list": async (input = {}) =>
      unbuilt("threads.list", input, LIST) ?? onRoot((await thread().list(input)) as result.ThreadListResult),
    "threads.read": async (input) =>
      unbuilt("threads.read", input, READ) ?? onRoot((await thread().read(input)) as result.ThreadReadResult),
    "threads.send": async (input) => {
      if (input?.author !== undefined)
        return threadFailure(fail("invalid_arguments", "author is a connector's field.", "Send without author.").error)
      return unbuilt("threads.send", input, SEND) ?? onRoot(await thread().send(input))
    },
    "threads.locate": async (input) => {
      const located = await thread().locate(input)
      if (located.kind === "error") return threadFailure(located.error)
      return { kind: "ok", thread: located.thread.address ?? located.thread.thread_id, located: located.thread }
    },
    "threads.create": async (input) => {
      if (typeof input?.prompt === "object") return notImplemented("threads.create")() as Promise<OmoFailure>
      return (
        unbuilt("threads.create", input, CREATE) ??
        onRoot((await thread().create(input as Parameters<ThreadCore["create"]>[0])) as result.ThreadCreateResult)
      )
    },
    "threads.receipt": async (input) => onRoot((await thread().receipt(input)) as result.ThreadReceiptResult),
    "threads.readAfterWait": async (input) =>
      unbuilt("threads.readAfterWait", input, [...READ, "wait_ms"]) ??
      onRoot((await thread().readAfterWait(input)) as result.ThreadReadAfterWaitResult),
    "threads.messages": async (input) => onRoot((await thread().messages(input)) as result.ThreadMessagesResult),
    "threads.interrupt": async (input) => onRoot((await thread().interrupt(input)) as result.ThreadInterruptResult),
    "threads.close": async (input = {}) => onRoot((await thread().close(input)) as result.ThreadCloseResult),
    "threads.rename": async (input = {}) => onRoot((await thread().rename(input)) as result.ThreadRenameResult),
    "threads.setModel": async (input) => onRoot((await thread().setModel(input)) as result.ThreadSetModelResult),
    "threads.release": async (input) => {
      const refused = unbuilt("threads.release", input, ["thread", "interrupt", "force"])
      if (refused !== undefined) return refused
      const released = onRoot(await thread().release(input))
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
      const registered = await thread().extensions.register(input)
      return registered.kind === "ok" ? registered : extensionFailure(registered)
    },
    "threads.extensions.call": async (input) => {
      const answered = await thread().extensions.call(input.name, input.op, input.args)
      return answered.kind === "ok" ? answered : extensionFailure(answered)
    },
    "daemon.warm": async (input = {}) => {
      const refused = unbuilt("daemon.warm", input, [])
      if (refused !== undefined) return refused
      try {
        return { kind: "ok", value: await thread().warm() }
      } catch (error) {
        // The warm's own transport error, as `omo daemon run` prints it today; slice C1a words it as the daemon core's.
        const message = error instanceof Error ? error.message : String(error)
        return { kind: "error", error: { code: "internal_error", message, next_action: "Run omo daemon run again." } }
      }
    },
  }
  // The caller's remote sessions and store are the root's to release even when no thread call ever built the core.
  const disposePorts = async (): Promise<void> => {
    await options.ports?.remote?.sessions.close?.().catch(() => undefined)
    await options.ports?.store?.dispose()
  }
  return {
    members,
    // The thread facade's release (design lane ruling on threads.release): the row its caller located, released where
    // that row is served, with no second lookup. Reachable only through the internal assembly, never the public root.
    releaseLocated: (located, request) => thread().releaseRow(located, request),
    dispose: async () => (core === undefined ? disposePorts() : core.dispose()),
  }
}
