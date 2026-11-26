import type { ThreadCreateInput } from "../../thread/contracts"
import type { GatewayStore } from "../../thread/gateway/store"
import type { ProvenanceWorkspaces } from "../../thread/gateway/provenance-resolver"
import type { WaitClock } from "../../call-budget/call-deadline"
import type { RemoteThreadSurface } from "../../thread/remote/ports"
import type { ThreadCore } from "../../thread/sdk-core"
import type { ThreadHost } from "../../thread/tools/ports"
import type { Endpoint, OmoFailure, OmoPrincipal, RootCallKey } from "../contract"
import type * as result from "../contract/results/threads"
import { extensionFailure } from "./extension-codes"
import type { Members, NamespaceServing } from "./members"
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
  /** Where the engine draws each delivery's id; absent, a random UUID (test seam). */
  readonly deliveryId?: () => string
  /** The clock a control's wait (signal, deadline_ms) reads; absent, the system clock (test seam). */
  readonly waitClock?: WaitClock
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
async function unbuilt(key: RootCallKey, input: unknown, acted: readonly string[]): Promise<OmoFailure | undefined> {
  if (typeof input !== "object" || input === null) return undefined
  const { ROOT_CALLS } = await import("../contract/calls")
  const schema = Object.keys((ROOT_CALLS[key].input as { readonly properties?: object }).properties ?? {})
  return notActed(
    key,
    Object.entries(input as Input)
      .filter(([field, value]) => value !== undefined && schema.includes(field) && !acted.includes(field))
      .map(([field]) => field),
  )
}

function notActed(key: RootCallKey, fields: readonly string[]): OmoFailure | undefined {
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

const LIST = ["all_scope", "state", "workspace", "device", "project", "name", "archived", "idempotency_key"]
const READ = ["thread", "max_bytes", "cursor", "all_scope", "limit", "idempotency_key"]
const SEND = [
  "thread",
  "message",
  "delivery",
  "expected_turn_id",
  "all_scope",
  "idempotency_key",
  "collapse_key",
  "attachments",
]
// The thread core and its contracts are imported on the first thread call, not when the entry loads (design lane ruling on
// the runtime's cold import): a script that only signs in never evaluates them.
const createFields = async (): Promise<readonly string[]> =>
  Object.keys((await import("../../thread/contracts")).threadToolParamSchemas.thread_create.properties)
/** The object prompt's fields the root acts on; `summary` has no carrier yet and `author` is slice P1a-s's. */
const FIRST = ["message", "delivery", "expected_turn_id", "attachments"]

/**
 * No leg carries an attachment yet: the gateway delivery on this device has no field for one, and neither has the relay
 * record a send to another device becomes, so a message with attachments is refused before any effect, never sent without
 * them.
 */
async function attachmentsRefused(attachments: unknown): Promise<OmoFailure | undefined> {
  if (!Array.isArray(attachments)) return undefined
  const count = attachments.length
  const { refusal } = await import("../../thread/refusal-texts")
  return threadFailure(
    refusal("control.send_attachments_unsupported", { count: String(count) }, { field: "attachments", count }),
  )
}

type FirstPrompt = {
  readonly message: string
  readonly delivery?: ThreadCreateInput["delivery"]
  readonly expected_turn_id?: string
  readonly attachments?: readonly unknown[]
}

/**
 * A create with the object prompt: the create plus one send of those inputs, delivered as the string prompt is (the same
 * sendToTarget, with the creator's authority). The prompt's own delivery and the create's top-level one name one thing,
 * so two different values are refused rather than one silently chosen.
 */
async function createWithObjectPrompt(
  input: Input,
  prompt: Input,
  core: ThreadCore,
): Promise<OmoFailure | { readonly created: Awaited<ReturnType<ThreadCore["create"]>> }> {
  const { prompt: _prompt, ...rest } = input
  const refused =
    (await unbuilt("threads.create", rest, await createFields())) ??
    notActed(
      "threads.create",
      Object.entries(prompt)
        .filter(([field, value]) => value !== undefined && !FIRST.includes(field))
        .map(([field]) => `prompt.${field}`),
    ) ??
    (await attachmentsRefused(prompt["attachments"]))
  if (refused !== undefined) return refused
  const first = prompt as FirstPrompt
  if (rest["delivery"] !== undefined && first.delivery !== undefined && rest["delivery"] !== first.delivery) {
    const { fail } = await import("../../thread/sdk-core/failures")
    return threadFailure(
      fail(
        "invalid_arguments",
        `delivery is ${String(rest["delivery"])} and prompt.delivery is ${first.delivery}; the first prompt takes one.`,
        "Pass the first prompt's delivery once, as prompt.delivery.",
      ).error,
    )
  }
  const delivery = first.delivery ?? (rest["delivery"] as FirstPrompt["delivery"])
  return {
    created: await core.create(
      { ...(rest as ThreadCreateInput), prompt: first.message, ...(delivery === undefined ? {} : { delivery }) },
      first.expected_turn_id === undefined ? undefined : { expected_turn_id: first.expected_turn_id },
    ),
  }
}

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
  let core: Promise<ThreadCore> | undefined
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
      return (
        (await unbuilt("threads.send", input, SEND)) ??
        (await attachmentsRefused(input?.attachments)) ??
        onRoot(await (await thread()).send(input))
      )
    },
    "threads.locate": async (input) => {
      const located = await (await thread()).locate(input)
      if (located.kind === "error") return threadFailure(located.error)
      return { kind: "ok", thread: located.thread.address ?? located.thread.thread_id, located: located.thread }
    },
    "threads.create": async (input) => {
      if (typeof input?.prompt === "object" && input.prompt !== null) {
        const outcome = await createWithObjectPrompt(input as Input, input.prompt as Input, await thread())
        return "created" in outcome ? onRoot(outcome.created as result.ThreadCreateResult) : outcome
      }
      return (
        (await unbuilt("threads.create", input, await createFields())) ??
        onRoot(
          (await (await thread()).create(input as Parameters<ThreadCore["create"]>[0])) as result.ThreadCreateResult,
        )
      )
    },
    "threads.receipt": async (input) => onRoot((await (await thread()).receipt(input)) as result.ThreadReceiptResult),
    "threads.readAfterWait": async (input) =>
      (await unbuilt("threads.readAfterWait", input, [...READ, "wait_ms"])) ??
      onRoot((await (await thread()).readAfterWait(input)) as result.ThreadReadAfterWaitResult),
    "threads.messages": async (input) =>
      onRoot((await (await thread()).messages(input)) as result.ThreadMessagesResult),
    "threads.interrupt": async (input, wait) =>
      onRoot((await (await thread()).interrupt(input, wait)) as result.ThreadInterruptResult),
    "threads.close": async (input = {}, wait) =>
      onRoot((await (await thread()).close(input, wait)) as result.ThreadCloseResult),
    "threads.unload": async (input, wait) =>
      onRoot((await (await thread()).unload(input, wait)) as result.ThreadUnloadResult),
    "threads.rename": async (input = {}, wait) =>
      onRoot((await (await thread()).rename(input, wait)) as result.ThreadRenameResult),
    "threads.setModel": async (input, wait) =>
      onRoot((await (await thread()).setModel(input, wait)) as result.ThreadSetModelResult),
    "threads.setReasoning": async (input, wait) =>
      onRoot((await (await thread()).setReasoning(input, wait)) as result.ThreadSetReasoningResult),
    "threads.archive": async (input, wait) =>
      onRoot((await (await thread()).archive(input, wait)) as result.ThreadArchiveResult),
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
  // The caller's remote sessions and store are the root's to release even when no thread call ever built the core.
  const disposePorts = async (): Promise<void> => {
    await options.ports?.remote?.sessions.close?.().catch(() => undefined)
    await options.ports?.store?.dispose()
  }
  return {
    members,
    // The thread facade's release (design lane ruling on threads.release): the row its caller located, released where
    // that row is served, with no second lookup. Reachable only through the internal assembly, never the public root.
    releaseLocated: async (located, request) => (await thread()).releaseRow(located, request),
    dispose: async () => (core === undefined ? disposePorts() : (await core).dispose()),
  }
}
