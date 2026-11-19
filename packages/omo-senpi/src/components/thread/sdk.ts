import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { deviceLabel } from "@oh-my-opencode/thread-address-core"

import { askHost } from "../../../../senpi-task/src/runners/rpc-host/host-request"
import { classifyWarmReply, type WarmAnswer } from "../../../../senpi-task/src/runners/rpc-host/host-warm-reply"

import { resolveAddress } from "./address"
import { toThreadAddressEntries, type AddressEntry } from "./address-book"
import type { ThreadAddressEntry } from "./addressing"
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
import { isUiRequestKind, UI_REQUEST_KINDS } from "./gateway/answer-shape"
import { type BindInput, OUTBOUND_EVENTS, type OutboundEvent } from "./gateway/bindings"
import type { GatewayRelay, RelayResult } from "./gateway/relay"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import { resolveProvenance, type ProvenanceWorkspaces } from "./gateway/provenance-resolver"
import type { ReportOpResult } from "./gateway/store-relay-ops"
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
import type {
  ExternalAuthor,
  GatewayDeliveryMode,
  GatewayDeliveryResult,
  GatewayDeliverySuccess,
} from "./gateway/types"
import { createLiveThreadSurface, parseHostStatusAll } from "./live-surface"
import { resolveThreadSocket } from "./live-surface-paths"
import { createGatewayResolver, createGatewayServices } from "./tools/gateway-services"
import { addressBook, hostView, sendAddressBook } from "./tools/internals"
import { UNKNOWN_CALLER, type ThreadHost, type ThreadToolSurfaceOptions } from "./tools/ports"
import { listThreads, readThread } from "./tools/read-ops"
import { sendView } from "./tools/send-view"
import { listAcross } from "./remote/cross-device"
import { TOOL_CALL_BUDGET_MS, withCallDeadline } from "../call-budget/call-deadline"
import type { RemoteThreadSurface } from "./remote/ports"
import { stampThisDevice } from "./remote/this-device"

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
type Relayed<K extends keyof GatewayRelay> = Promise<Awaited<ReturnType<GatewayRelay[K]>> | Failure>
/**
 * Whether an armed completion's wake reached the running session. When it did not, the durable arm is
 * picked up at the session's next start: `no_live_endpoint` (nothing lists the session live),
 * `not_routable` (its host lists no live session under the durable id), `unreachable` (the wake failed).
 */
export type ArmWake =
  | { readonly reached: true }
  | {
      readonly reached: false
      readonly reason: "no_live_endpoint" | "not_routable" | "unreachable"
      readonly detail?: string
    }

/** A report as the SDK answers it: the arm's sequence number stays inside the gateway; an armed completion says whether its wake reached the session. */
type Reported = Promise<
  RelayResult<Omit<ReportOpResult, "arm_seq"> & { readonly deduplicated: boolean; readonly wake?: ArmWake }> | Failure
>

/** A send's answer: the gateway's delivery facts, with the session named `thread`, the address `read` and `send` take back. */
export type ThreadSdkSendResult =
  | (Omit<GatewayDeliverySuccess, "thread_id"> & { readonly thread: string })
  | Exclude<GatewayDeliveryResult, GatewayDeliverySuccess>

/** Where a session lives right now, as `omo daemon adopt` needs it. */
export type LocatedThread = Pick<
  AddressEntry,
  "thread_id" | "title" | "cwd" | "status" | "session_path" | "endpoint" | "surface" | "alive"
> & {
  /** A thread on another device: its device id and the address every tool accepts (absent on this device). */
  readonly device?: string
  readonly address?: string
}

export type ThreadSdk = StoreExtensionApi & {
  /** `cli:<uid>`: the principal every receipt, budget and bindingless send of this SDK is keyed by. */
  readonly principal: string
  /** `state`: the thread states to list; the default lists every state but archived. */
  readonly list: (request: Scoped & { readonly state?: readonly ThreadState[] }) => Promise<ThreadToolResult>
  readonly read: (
    request: Scoped & { readonly thread: string; readonly max_bytes?: number; readonly cursor?: string },
  ) => Promise<ThreadToolResult>
  /**
   * Bindingless: the `cli` sender. With `binding_id`: the connector inbound path (`event:<key>` admitted once), with an
   * optional `author` and a `mode` capped by the binding's `inbound_mode`; `author` without `binding_id` is `invalid_arguments`.
   */
  readonly send: (
    request: Scoped &
      Keyed & {
        readonly thread?: string
        readonly text: string
        readonly mode?: GatewayDeliveryMode
        readonly expected_turn_id?: number
        readonly binding_id?: string
        readonly author?: ExternalAuthor
      },
  ) => Promise<ThreadSdkSendResult>
  readonly bind: (
    request: Scoped & Keyed & { readonly session: string; readonly binding: Omit<BindInput, "session_durable_id"> },
  ) => Relayed<"bind">
  readonly unbind: (
    request: Keyed & { readonly binding_id: string; readonly expected_revision: number },
  ) => Relayed<"unbind">
  readonly rebind: (
    request: Scoped &
      Keyed & { readonly binding_id: string; readonly expected_revision: number; readonly session: string },
  ) => Relayed<"rebind">
  readonly bindings: (
    request: Scoped & {
      readonly session?: string
      readonly platform?: string
      readonly account_id?: string
      readonly chat_id?: string
      readonly thread_id?: string
      readonly status?: string
      readonly cursor?: string
      readonly limit?: number
    },
  ) => Relayed<"bindings">
  readonly report: (
    request: Scoped &
      Keyed & {
        readonly session: string
        readonly kind: string
        readonly text: string
        readonly binding_id?: string
        readonly request_id?: string
        readonly request_kind?: string
      },
  ) => Reported
  readonly outbox: (request: {
    readonly binding_id: string
    readonly after_cursor?: number
    readonly limit?: number
  }) => Relayed<"outbox">
  readonly ack: (request: {
    readonly binding_id: string
    readonly cursor: number
    readonly provider_message_id?: string
  }) => Relayed<"ack">
  readonly answer: (request: {
    readonly binding_id: string
    readonly reply_token: string
    readonly answer: string
    readonly author?: ExternalAuthor
  }) => Relayed<"answer">
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
 * book, engine and relay, without an agent session. It never starts a host; it reads the endpoints
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
      senderProvenance: () =>
        stampThisDevice(
          resolveProvenance({
            cwd: options.cwd,
            env,
            ...(options.provenanceWorkspaces === undefined ? {} : { workspaces: options.provenanceWorkspaces }),
          }),
          options.remote,
        ),
      resolveTarget: (address, request) => resolveForExtension(address, request),
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
  const { relay, endpoints, locate, pipeline } = createGatewayServices(
    { ...surface, ...(options.remote === undefined ? {} : { remote: options.remote }) },
    () => hostView(surface, { offline: true }),
  )
  // An extension call resolves its target while the store worker runs that call's transaction, so it
  // takes the store-free live-and-disk resolver: the send path's `resolve` first asks this same store
  // for the session's owner, a request the busy worker would only answer after the call's budget.
  const resolveForExtension = createGatewayResolver(surface, () => hostView(surface, { offline: true }))

  // A running session writes a completion only once it knows of the arm; the arm is durable, so a
  // wake that does not get through leaves it to the session's next start, and the report says so.
  async function wakeForArm(durableId: string): Promise<ArmWake> {
    const unreachable = (error: unknown): ArmWake => ({
      reached: false,
      reason: "unreachable",
      detail: error instanceof Error ? error.message : String(error),
    })
    let endpoint: Awaited<ReturnType<typeof locate>>
    try {
      endpoint = await locate(durableId)
    } catch (error) {
      return unreachable(error)
    }
    if (endpoint === null) return { reached: false, reason: "no_live_endpoint" }
    try {
      const reply = await endpoints.wake(endpoint, [])
      return reply.unroutable === undefined ? { reached: true } : { reached: false, reason: "not_routable" }
    } catch (error) {
      return unreachable(error)
    }
  }

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

  // The shared resolver's context, as far as it is fixed for this SDK instance (the local book each call builds
  // is spread in per call). `self` never resolves for the CLI (UNKNOWN_CALLER), exactly as before.
  const resolveContext = (local: readonly ThreadAddressEntry[]) => ({
    remote: options.remote,
    callerWorkspaceRoot: surface.callerWorkspaceRoot(),
    local,
    callerId: UNKNOWN_CALLER,
  })

  /**
   * A session a store-only operation names (bind, rebind, bindings --session, report, a bound send's target), through
   * the one address module. These operations write THIS device's gateway store, so the address resolves on this device
   * first, exactly as before the module (a name a local session shares with another device's thread is the local
   * session); only a local not_found consults the account, so a thread that lives on another device is refused naming
   * that device instead of a bare not_found.
   */
  async function sessionId(address: string, allScope: boolean | undefined): Promise<{ readonly id: string } | Failure> {
    const offline = await sendView(surface, address, () => hostView(surface, { offline: true }))
    const context = resolveContext(toThreadAddressEntries(sendAddressBook(surface, offline, bareOf(address), allScope)))
    const here = await resolveAddress({ ...context, remote: undefined }, address, { all_scope: allScope })
    const resolved =
      here.kind === "error" && here.code === "not_found" && options.remote !== undefined
        ? await resolveAddress(context, address, { all_scope: allScope, probe: true })
        : here
    if (resolved.kind === "error") return { kind: "error", error: resolved }
    if (resolved.where.kind === "device") {
      const device = resolved.device
      const id = resolved.where.row.device
      return fail(
        "unsupported",
        `Session ${resolved.thread} is held on ${deviceLabel({ id, name: device?.name ?? id })}, not on this device; this device's gateway holds bindings and reports only for sessions it holds.`,
        "Run the bind or report on that device, or name a session this device holds.",
        {
          thread: resolved.thread,
          device: id,
          ...(device === null ? {} : { device_name: device.name }),
          address: resolved.address,
          reason: "session_on_other_device",
        },
      )
    }
    return { id: resolved.thread }
  }

  function named(sent: GatewayDeliveryResult): ThreadSdkSendResult {
    if (sent.kind !== "ok") return sent
    const { thread_id, ...facts } = sent
    return { ...facts, thread: thread_id }
  }

  async function inbound(
    request: Parameters<ThreadSdk["send"]>[0] & { readonly binding_id: string },
  ): Promise<GatewayDeliveryResult> {
    if (request.thread !== undefined) {
      const binding = await store.bindingView({ now: now(), binding_id: request.binding_id })
      // An explicit durable id that IS the binding's session needs no validating lookup: the inbound
      // delivery resolves that same owner once, so a bound send pays one lookup budget like any
      // other send. Any other address still resolves here to enforce the match.
      if (binding === null || binding.session_durable_id !== request.thread) {
        const target = await sessionId(request.thread, request.all_scope)
        if ("kind" in target) return target
        if (binding !== null && binding.session_durable_id !== target.id) {
          return fail(
            "invalid_arguments",
            `Binding ${binding.binding_id} delivers to session ${binding.session_durable_id}, not ${target.id}.`,
            "Drop the target (the binding names its session) or pass the binding of that session.",
            { binding_id: binding.binding_id, session: binding.session_durable_id },
          )
        }
      }
    }
    if (request.expected_turn_id !== undefined)
      return fail(
        "invalid_arguments",
        "A binding message never steers, so it takes no expected_turn_id.",
        "Drop expected_turn_id.",
      )
    if (request.mode === "steer")
      return fail(
        "invalid_arguments",
        "A binding message is delivered as auto or follow_up, never steer.",
        "Send with mode auto or follow_up, or omit it for the binding's inbound_mode.",
      )
    return await relay.inbound({
      binding_id: request.binding_id,
      event_id: request.idempotency_key ?? randomUUID(),
      text: request.text,
      ...(request.author === undefined ? {} : { author: request.author }),
      ...(request.mode === undefined ? {} : { mode: request.mode }),
    })
  }

  return {
    registerStoreExtension: store.registerStoreExtension,
    extensionCall: store.extensionCall,
    principal,
    list: (request) =>
      guarded(async () =>
        listAcross(
          options.remote,
          listThreads(surface, await view(), request.all_scope, request.state),
          request.all_scope === true,
          request.state,
        ),
      ),
    read: (request) =>
      guarded(async () =>
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
        if (request.binding_id !== undefined)
          return named(await inbound({ ...request, binding_id: request.binding_id }))
        if (request.thread === undefined)
          return fail(
            "invalid_arguments",
            "A send without a binding needs a target session.",
            "Pass the target session, or --binding to deliver through a binding.",
          )
        if (request.author !== undefined)
          return fail(
            "invalid_arguments",
            "An author names a human in a bound external thread; a send without a binding has none.",
            "Pass binding_id with the author, or drop the author.",
          )
        // The same road as an agent's send: the address resolves through the address module (across the account when this SDK
        // has one, this device only otherwise), and the target's kind picks the transport. Like the agent's thread_send, an id
        // this device's gateway owns needs no lookup (no host listing, no account call); any other address resolves over the
        // offline view and the send address book, so a thread that is not running with nothing live answering still queues offline.
        let target: DeliveryTarget = {
          kind: "local",
          thread_id: request.thread,
          ...(request.all_scope === undefined ? {} : { all_scope: request.all_scope }),
        }
        if ((await store.sessionOwner(request.thread)) === null) {
          const offline = await hostView(surface, { offline: true })
          const across = await resolveAddress(
            resolveContext(toThreadAddressEntries(sendAddressBook(surface, offline, bareOf(request.thread), true))),
            request.thread,
            { all_scope: request.all_scope },
          )
          if (across.kind === "error")
            return fail(
              across.code,
              across.message,
              across.next_action,
              "details" in across ? (across as { details?: Readonly<Record<string, unknown>> }).details : undefined,
            )
          target =
            across.where.kind === "device"
              ? { kind: "remote", row: across.where.row }
              : {
                  kind: "local",
                  thread_id: across.thread,
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
    bind: (request) =>
      guarded(async () => {
        const session = await sessionId(request.session, request.all_scope)
        if ("kind" in session) return session
        return await relay.bind({
          principal,
          ...keyed(request),
          binding: { ...request.binding, session_durable_id: session.id },
        })
      }),
    unbind: (request) =>
      guarded(() =>
        relay.unbind({
          principal,
          ...keyed(request),
          binding_id: request.binding_id,
          expected_revision: request.expected_revision,
        }),
      ),
    rebind: (request) =>
      guarded(async () => {
        const session = await sessionId(request.session, request.all_scope)
        if ("kind" in session) return session
        return await relay.rebind({
          principal,
          ...keyed(request),
          binding_id: request.binding_id,
          expected_revision: request.expected_revision,
          session_durable_id: session.id,
        })
      }),
    bindings: (request) =>
      guarded(async () => {
        const { session: address, all_scope: allScope, cursor, limit, ...filter } = request
        const session = address === undefined ? undefined : await sessionId(address, allScope)
        if (session !== undefined && "kind" in session) return session
        return await relay.bindings({
          filter: { ...filter, ...(session === undefined ? {} : { session_durable_id: session.id }) },
          ...(cursor === undefined ? {} : { cursor }),
          ...(limit === undefined ? {} : { limit }),
        })
      }),
    report: (request) =>
      guarded(async () => {
        const event = OUTBOUND_EVENTS.find((candidate): candidate is OutboundEvent => candidate === request.kind)
        if (event === undefined)
          return fail(
            "invalid_arguments",
            `The report kind must be one of ${OUTBOUND_EVENTS.join(", ")}.`,
            "Pass milestone, report, question or completion.",
          )
        const requestKind = request.request_kind
        if (requestKind !== undefined && !isUiRequestKind(requestKind))
          return fail(
            "invalid_arguments",
            `The request kind must be one of ${UI_REQUEST_KINDS.join(", ")}.`,
            "Pass question, select, confirm, input or editor.",
          )
        const session = await sessionId(request.session, request.all_scope)
        if ("kind" in session) return session
        const reported = await relay.report({
          principal,
          ...keyed(request),
          session_durable_id: session.id,
          event,
          text: request.text,
          ...(request.binding_id === undefined ? {} : { binding_id: request.binding_id }),
          ...(request.request_id === undefined ? {} : { request_id: request.request_id }),
          ...(requestKind === undefined ? {} : { request_kind: requestKind }),
        })
        if (reported.kind !== "ok") return reported
        // The arm's sequence number is the running session's settle watermark, read back on the wake; not part of the result.
        const { arm_seq: _armSeq, ...result } = reported
        return result.armed ? { ...result, wake: await wakeForArm(session.id) } : result
      }),
    outbox: (request) => guarded(() => relay.outbox(request)),
    ack: (request) => guarded(() => relay.ack(request)),
    answer: (request) =>
      guarded(() =>
        relay.answer({
          binding_id: request.binding_id,
          reply_token: request.reply_token,
          answer: request.answer,
          ...(request.author === undefined ? {} : { author: request.author }),
        }),
      ),
    locate: (request) =>
      guarded(async () => {
        const current = await view()
        const resolved = await resolveAddress(
          resolveContext(toThreadAddressEntries(addressBook(surface, current))),
          request.thread,
          { all_scope: request.all_scope, probe: true },
        )
        if (resolved.kind === "error") return { kind: "error", error: resolved } as const
        // A thread on another device: the same located shape, carrying its device and the address every tool takes.
        if (resolved.where.kind === "device") {
          const { thread_id, name, cwd, status } = resolved.entry
          return {
            kind: "ok",
            thread: {
              thread_id,
              title: name,
              cwd,
              status,
              session_path: null,
              endpoint: null,
              surface: null,
              alive: status === "live",
              device: resolved.where.row.device,
              address: resolved.address,
            },
          } as const
        }
        const entries = addressBook(surface, current).filter((entry) => entry.thread_id === resolved.thread)
        const entry = entries.find((candidate) => candidate.alive) ?? entries[0]
        if (entry === undefined)
          return fail(
            "not_found",
            `Thread ${resolved.thread} is not in the address book.`,
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
      relay.dispose()
      await options.remote?.sessions.close?.().catch(() => undefined)
      return store.dispose()
    },
  }
}

function keyed(request: Keyed): Keyed {
  return request.idempotency_key === undefined ? {} : { idempotency_key: request.idempotency_key }
}

const HERE_PREFIX = "here/"

/** The thread part of a `here/<thread>` address, for building the local book: a session file answers a bare id. */
const bareOf = (address: string): string =>
  address.startsWith(HERE_PREFIX) ? address.slice(HERE_PREFIX.length) : address
