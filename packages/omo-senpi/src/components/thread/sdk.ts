import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { askHost } from "../../../../senpi-task/src/runners/rpc-host/host-request"
import { classifyWarmReply, type WarmAnswer } from "../../../../senpi-task/src/runners/rpc-host/host-warm-reply"

import { toThreadAddressEntries, type AddressEntry } from "./address-book"
import {
  parseThreadParams,
  threadToolParamSchemas,
  type ThreadCloseInput,
  type ThreadCreateInput,
  type ThreadInterruptInput,
  type ThreadRenameInput,
  type ThreadSetModelInput,
  type ThreadState,
  type ThreadToolResult,
} from "./contracts"
import { createThread } from "./control/create"
import { locateControl } from "./control/locate"
import { answered, closeThread, interruptThread, NOT_LIVE, setModelOn } from "./control/operations"
import { renameThread } from "./control/rename"
import { controlIdentity } from "./control/port"
import { gatewaySchemaRefusal, threadToolFailure, type ThreadToolFailure } from "./errors"
import type { ReleaseSessionReply, ReleaseSessionRequest } from "./gateway/adapter"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import type { ProvenanceWorkspaces } from "./gateway/provenance-resolver"
import type { StoreExtensionApi } from "./gateway/store-extensions"
export type {
  StoreExtensionApi,
  StoreExtensionRegistration,
  StoreExtensionTransaction,
  StoreExtensionOperation,
  StoreExtensionResult,
  StoreExtensionRefusal,
  StoreExtensionRefusalCode,
} from "./gateway/store-extensions"
import type { DeliveryTarget } from "./gateway/transport"
import type { GatewayDeliveryMode, GatewayDeliveryResult, GatewayDeliverySuccess } from "./gateway/types"
import { createLiveThreadSurface, parseHostStatusAll } from "./live-surface"
import { resolveThreadSocket } from "./live-surface-paths"
import { createGatewayServices } from "./tools/gateway-services"
import { addressBook, hostView, resolution, resolveEntries, sendAddressBook, resolveAcross } from "./tools/internals"
import { UNKNOWN_CALLER, type ThreadHost, type ThreadToolSurfaceOptions } from "./tools/ports"
import { listThreads, readThread } from "./tools/read-ops"
import { listAcross } from "./remote/cross-device"
import { TOOL_CALL_BUDGET_MS, withCallDeadline } from "../call-budget/call-deadline"
import type { RemoteThreadSurface } from "./remote/ports"

export type ThreadSdkOptions = {
  readonly agentDir: string
  /** The caller's working directory: the workspace a call without `all_scope` is scoped to. */
  readonly cwd: string
  readonly uid: number
  readonly user: string
  readonly env?: Readonly<Record<string, string | undefined>>
  /**
   * The caller's `provenance.workspaces` table. The SDK is a standalone build that does not read omo.json itself;
   * without a table, sends are classified by the caller's environment (`OMO_PROVENANCE_*`) and git owner only.
   */
  readonly provenanceWorkspaces?: ProvenanceWorkspaces
  /** The engine's `host status --all --include-workers --json` stdout; the caller owns how the engine is run. */
  readonly engineStatusAll?: () => Promise<string | undefined>
  /** Where the store worker sidecar is resolved from when this SDK is not loaded from `omo.js`. */
  readonly workerModuleUrl?: string | URL
  readonly host?: ThreadHost
  readonly store?: GatewayStore
  readonly now?: () => number
  /**
   * The account's other devices and its alias registry (the CLI passes the thread client sidecar's `createCliRemoteSurface`):
   * `read` then resolves an address exactly as the agent's `thread_read` does. Absent, it reads this device only.
   */
  readonly remote?: RemoteThreadSurface
}

/**
 * The SDK's boundary check: a script that calls `createThreadSdk()` with no options, or without one of the four fields
 * every operation reads, gets a TypeError naming the missing fields instead of a property read deep inside.
 */
export function assertThreadSdkOptions(options: unknown): asserts options is ThreadSdkOptions {
  const given = typeof options === "object" && options !== null ? (options as Record<string, unknown>) : {}
  const missing = [
    ...(["agentDir", "cwd", "user"] as const).filter(
      (field) => typeof given[field] !== "string" || (given[field] as string).length === 0,
    ),
    ...(typeof given["uid"] === "number" ? [] : ["uid"]),
  ]
  if (missing.length > 0)
    throw new TypeError(`createThreadSdk needs { agentDir, cwd, uid, user }; missing or invalid: ${missing.join(", ")}`)
}

type Failure = { readonly kind: "error"; readonly error: ThreadToolFailure }
type Scoped = { readonly all_scope?: boolean }
type Keyed = { readonly idempotency_key?: string }
/** A send's answer: the gateway's delivery facts, with the session named `thread`, the address `read` and `send` take back. */
export type ThreadSdkSendResult =
  | (Omit<GatewayDeliverySuccess, "thread_id"> & { readonly thread: string })
  | Exclude<GatewayDeliveryResult, GatewayDeliverySuccess>

/** Where a session lives right now, as `omo daemon adopt` needs it. */
export type LocatedThread = Pick<
  AddressEntry,
  "thread_id" | "title" | "cwd" | "status" | "session_path" | "endpoint" | "surface" | "alive"
>

export type ThreadSdk = StoreExtensionApi & {
  /** `cli:<uid>`: the principal every receipt, budget and send of this SDK is keyed by. */
  readonly principal: string
  /** `state`: the thread states to list; the default lists every state but archived. */
  readonly list: (request: Scoped & { readonly state?: readonly ThreadState[] }) => Promise<ThreadToolResult>
  readonly read: (
    request: Scoped & { readonly thread: string; readonly max_bytes?: number; readonly cursor?: string },
  ) => Promise<ThreadToolResult>
  /** A send to a session by id, alias or name, as the `cli` sender, on the agent's `thread_send` road. */
  readonly send: (
    request: Scoped &
      Keyed & {
        readonly thread: string
        readonly text: string
        readonly mode?: GatewayDeliveryMode
        readonly expected_turn_id?: number
      },
  ) => Promise<ThreadSdkSendResult>
  readonly locate: (
    request: Scoped & { readonly thread: string },
  ) => Promise<{ readonly kind: "ok"; readonly thread: LocatedThread } | Failure>
  /**
   * The session controls of the agent tools (thread_create, thread_interrupt, thread_close, thread_rename,
   * thread_set_model): the same arguments, bodies and results, on this device or another of the account. The SDK acts as
   * itself, never as a session, so `self` is `caller_context_missing` and a created thread records no creator.
   */
  readonly create: (request: ThreadCreateInput) => Promise<ThreadToolResult>
  readonly interrupt: (request: ThreadInterruptInput) => Promise<ThreadToolResult>
  readonly close: (request: ThreadCloseInput) => Promise<ThreadToolResult>
  readonly rename: (request: ThreadRenameInput) => Promise<ThreadToolResult>
  readonly set_model: (request: ThreadSetModelInput) => Promise<ThreadToolResult>
  /** senpi `release_session` on the host that serves `thread`; a thrown transport failure is answered as `host_unavailable`. */
  readonly release: (
    thread: LocatedThread,
    request: Omit<ReleaseSessionRequest, "reason">,
  ) => Promise<ReleaseSessionReply>
  /**
   * senpi's `warm` on the operator daemon (`omo daemon run`, after its ensure): the host loads omo with no session open,
   * so its thread component starts the wake and declares the delivery consumer at once (#13037 cold wake).
   */
  readonly warmDaemon: () => Promise<WarmAnswer>
  readonly dispose: () => Promise<void>
}

// The first load compiles the extension graph; a loaded host answers in well under a second (the task host's bound).
const DAEMON_WARM_TIMEOUT_MS = 60_000

function fail(
  code: Parameters<typeof threadToolFailure>[0],
  message: string,
  next: string,
  details?: Readonly<Record<string, unknown>>,
): Failure {
  return { kind: "error", error: threadToolFailure(code, message, next, details) }
}

/** The same mapping the tools apply to a thrown surface failure, so a script sees data, never a stack. */
function thrown(error: unknown): Failure {
  const schema = gatewaySchemaRefusal(error)
  if (schema !== undefined) return { kind: "error", error: schema }
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith("host_unavailable:"))
    return fail(
      "host_unavailable",
      `The thread host is unavailable at ${message.slice("host_unavailable:".length)}.`,
      "Retry when a host or terminal session is running.",
    )
  if (message.startsWith("unsupported:"))
    return fail(
      "unsupported",
      `The target's endpoint does not accept ${message.slice("unsupported:".length)}.`,
      "Use thread read to follow the session.",
      { command: message.slice("unsupported:".length) },
    )
  return fail(
    "internal_error",
    `Thread operation failed: ${message}`,
    "Run omo thread list and retry after checking the target.",
  )
}

/**
 * A script names only the keys an operation reads: a misspelt one (`allScope` for `all_scope`) is refused by name
 * instead of silently ignored (#14316).
 */
function unknownKeys(request: object, known: readonly string[]): Failure | undefined {
  const unknown = Object.keys(request).filter((key) => !known.includes(key))
  if (unknown.length === 0) return undefined
  return fail(
    "invalid_arguments",
    `Unknown option${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`,
    `Pass only ${known.join(", ")}.`,
    { unknown },
  )
}

const LIST_KEYS = ["all_scope", "state"] as const
const READ_KEYS = ["thread", "max_bytes", "cursor", "all_scope"] as const
const SEND_KEYS = ["thread", "text", "mode", "expected_turn_id", "all_scope", "idempotency_key"] as const
const LOCATE_KEYS = ["thread", "all_scope"] as const

// omo#14130: every SDK operation runs inside one tool-call budget, as an agent's thread tool call does (tools.ts).
async function guarded<T>(body: () => Promise<T>): Promise<T | Failure> {
  try {
    return await withCallDeadline(Date.now() + TOOL_CALL_BUDGET_MS, body)
  } catch (error) {
    return thrown(error)
  }
}

/**
 * The script-callable thread surface: every operation the agent tools offer, over the same address
 * book and engine, without an agent session. It never starts a host; it reads the endpoints
 * the engine enumerates and the gateway store under `agentDir`.
 */
export function createThreadSdk(options: ThreadSdkOptions): ThreadSdk {
  assertThreadSdkOptions(options)
  const principal = `cli:${options.uid}`
  const env = { ...(options.env ?? process.env), OMO_CODING_AGENT_DIR: options.agentDir }
  const engineStatusAll = options.engineStatusAll
  const host =
    options.host ??
    createLiveThreadSurface(undefined, {
      env,
      ...(engineStatusAll === undefined ? {} : { statusAll: async () => parseHostStatusAll(await engineStatusAll()) }),
    })
  const store =
    options.store ??
    createGatewayStore({
      agentDir: options.agentDir,
      ...(options.workerModuleUrl === undefined ? {} : { workerModuleUrl: options.workerModuleUrl }),
    })
  const now = options.now ?? store.now
  const workspaces = options.provenanceWorkspaces
  const surface: ThreadToolSurfaceOptions = {
    host,
    store,
    env,
    ...(workspaces === undefined ? {} : { loadProvenanceWorkspaces: () => workspaces }),
    stateDirectory: options.agentDir,
    sessionsDirectory: () => join(options.agentDir, "sessions"),
    callerSessionId: () => UNKNOWN_CALLER,
    callerWorkspaceRoot: () => options.cwd,
    now,
  }
  const view = () => hostView(surface)
  const { pipeline } = createGatewayServices(
    { ...surface, ...(options.remote === undefined ? {} : { remote: options.remote }) },
    () => hostView(surface, { offline: true }),
  )
  const controls: ThreadToolSurfaceOptions = {
    ...surface,
    ...(options.remote === undefined ? {} : { remote: options.remote }),
  }
  // One session control as its tool runs it: the tool's parameter schema, then its body, a control's typed refusal as data.
  function control<I>(
    schema: (typeof threadToolParamSchemas)[
      "thread_create" | "thread_interrupt" | "thread_close" | "thread_rename" | "thread_set_model"],
    request: I,
    body: (value: I) => Promise<ThreadToolResult>,
  ): Promise<ThreadToolResult> {
    return guarded(async () => {
      const parsed = parseThreadParams(schema, request)
      if (parsed.kind === "error") return parsed as ThreadToolResult
      return await answered(() => body(parsed.value as I))
    })
  }
  async function located(address: string, allScope: boolean | undefined) {
    return await locateControl(controls, await view(), address, allScope, UNKNOWN_CALLER)
  }

  function named(sent: GatewayDeliveryResult): ThreadSdkSendResult {
    if (sent.kind !== "ok") return sent
    const { thread_id, ...facts } = sent
    return { ...facts, thread: thread_id }
  }

  return {
    registerStoreExtension: store.registerStoreExtension,
    extensionCall: store.extensionCall,
    principal,
    list: (request) =>
      guarded(
        async () =>
          unknownKeys(request, LIST_KEYS) ??
          listAcross(
            options.remote,
            listThreads(surface, await view(), request.all_scope, request.state),
            request.all_scope === true,
            request.state,
          ),
      ),
    read: (request) =>
      guarded(
        async () =>
          unknownKeys(request, READ_KEYS) ??
          readThread(
            { ...surface, ...(options.remote === undefined ? {} : { remote: options.remote }) },
            await view(),
            {
              thread: request.thread,
              max_bytes: request.max_bytes,
              cursor: request.cursor,
              all_scope: request.all_scope,
            },
            UNKNOWN_CALLER,
          ),
      ),
    send: (request) =>
      guarded(async () => {
        const refused = unknownKeys(request, SEND_KEYS)
        if (refused !== undefined) return refused
        // The same road as an agent's send: the address resolves across the account, and the target's kind picks the transport.
        // Like the agent's thread_send, a published id needs no lookup (no host listing, no account call), and any other address
        // resolves over the offline view and the send address book, so an own alias is account-wide and a thread that is not
        // running with nothing live answering still queues offline.
        let target: DeliveryTarget = {
          kind: "local",
          thread_id: request.thread,
          ...(request.all_scope === undefined ? {} : { all_scope: request.all_scope }),
        }
        const remote = options.remote
        if (remote !== undefined && (await store.sessionOwner(request.thread)) === null) {
          const offline = await hostView(surface, { offline: true })
          const across = await resolveAcross(
            { ...surface, remote },
            toThreadAddressEntries(sendAddressBook(surface, offline, request.thread, true)),
            request.thread,
            UNKNOWN_CALLER,
            request.all_scope,
          )
          if (across.kind === "error")
            return fail(
              across.code,
              across.message,
              across.next_action,
              "details" in across ? (across as { details?: Readonly<Record<string, unknown>> }).details : undefined,
            )
          target =
            across.entry.transport?.kind === "relay"
              ? { kind: "remote", row: across.entry.transport.row }
              : {
                  kind: "local",
                  thread_id: across.entry.thread_id,
                  ...(across.all_scope === undefined ? {} : { all_scope: across.all_scope }),
                }
        }
        const sent = await pipeline.deliver({
          sender: { kind: "cli", uid: options.uid, user: options.user },
          caller_id: principal,
          target,
          text: request.text,
          mode: request.mode ?? "auto",
          ...(request.expected_turn_id === undefined ? {} : { expected_turn_id: String(request.expected_turn_id) }),
          idempotency_key: request.idempotency_key ?? `auto:${randomUUID()}`,
          args: request,
        })
        if (sent.kind === "ok" && "device" in sent)
          return fail(
            "internal_error",
            `A command-line send reached a session on device ${sent.device}, which the engine does not admit.`,
            "Report this: the relay transport must refuse a command-line sender before sending.",
          )
        return named(sent)
      }),
    locate: (request) =>
      guarded(async () => {
        const refused = unknownKeys(request, LOCATE_KEYS)
        if (refused !== undefined) return refused
        const current = await view()
        const resolved = resolution(
          surface,
          resolveEntries(surface, current),
          request.thread,
          UNKNOWN_CALLER,
          request.all_scope,
        )
        if (resolved.kind === "error") return { kind: "error", error: resolved } as const
        const entries = addressBook(surface, current).filter((entry) => entry.thread_id === resolved.entry.thread_id)
        const entry = entries.find((candidate) => candidate.alive) ?? entries[0]
        if (entry === undefined)
          return fail(
            "not_found",
            `Thread ${resolved.entry.thread_id} is not in the address book.`,
            "Run omo thread list --all-scope.",
          )
        const { thread_id, title, cwd, status, session_path, endpoint, surface: where, alive } = entry
        return {
          kind: "ok",
          thread: { thread_id, title, cwd, status, session_path, endpoint, surface: where, alive },
        } as const
      }),
    create: (request) =>
      control(threadToolParamSchemas.thread_create, request, async (value) =>
        createThread(controls, await view(), value, {
          operationId: value.idempotency_key ?? `auto:${randomUUID()}`,
          callerId: UNKNOWN_CALLER,
          view,
          deliverPrompt: async (_current, target, send, key) => {
            // The script created the thread, so its first prompt carries the creator's authority (#14045), as the tool's does.
            const sent = await pipeline.deliver({
              sender: { kind: "cli", uid: options.uid, user: options.user },
              caller_id: principal,
              target,
              text: send.message,
              mode: send.delivery ?? "auto",
              idempotency_key: key,
              args: send,
              authority: "creator",
            })
            if (sent.kind === "error") return { kind: "error", error: sent.error }
            const { thread_id, ...facts } = sent
            return { ...facts, thread: thread_id } as ThreadToolResult
          },
        }),
      ),
    interrupt: (request) =>
      control(threadToolParamSchemas.thread_interrupt, request, async (value) => {
        const found = await located(value.thread, value.all_scope)
        if (found.kind === "error") return found.result
        if (found.kind === "not_live") return NOT_LIVE
        return await interruptThread(found.control, value.turn_id)
      }),
    close: (request) =>
      control(threadToolParamSchemas.thread_close, request, async (value) => {
        const found = await located(value.thread ?? "self", value.all_scope)
        if (found.kind === "error") return found.result
        // Nothing live holds it: there is nothing to close, and the thread stays resumable from its session file.
        if (found.kind === "not_live")
          return { kind: "ok", ...controlIdentity(found), closed: false, reason: "not_live", dropped_deliveries: [] }
        return await closeThread(found.control, value.force)
      }),
    rename: (request) =>
      control(threadToolParamSchemas.thread_rename, request, async (value) =>
        renameThread(controls, await view(), value, value.idempotency_key ?? `auto:${randomUUID()}`, UNKNOWN_CALLER),
      ),
    set_model: (request) =>
      control(threadToolParamSchemas.thread_set_model, request, async (value) => {
        const found = await located(value.thread, value.all_scope)
        if (found.kind === "error") return found.result
        if (found.kind === "not_live") return NOT_LIVE
        return await setModelOn(found.control, value.model, value.provider)
      }),
    release: async (thread, request) => {
      const releaseSession = host.gateway?.releaseSession
      if (releaseSession === undefined || thread.endpoint === null)
        return { success: false, error: "release_unsupported" }
      try {
        return await releaseSession(thread.endpoint, { reason: "takeover", ...request })
      } catch (error) {
        const failure = thrown(error)
        return { success: false, error: failure.error.code, errorData: { hint: failure.error.message } }
      }
    },
    warmDaemon: async () =>
      classifyWarmReply(
        await askHost(
          resolveThreadSocket(env),
          { id: `omo-daemon-warm-${randomUUID()}`, type: "warm" },
          DAEMON_WARM_TIMEOUT_MS,
          { agentDir: options.agentDir },
        ),
      ),
    dispose: async () => {
      await options.remote?.sessions.close?.().catch(() => undefined)
      return store.dispose()
    },
  }
}
