import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { askHost } from "../../../../senpi-task/src/runners/rpc-host/host-request"
import { classifyWarmReply, type WarmAnswer } from "../../../../senpi-task/src/runners/rpc-host/host-warm-reply"

import { resolveAddress } from "./address"
import { toThreadAddressEntries, type AddressEntry } from "./address-book"
import type { ThreadAddressEntry } from "./addressing"
import {
  DEFAULT_THREAD_DELIVERY,
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
import { awaitPromptStart, FIRST_PROMPT_START_RESERVE_MS, FIRST_PROMPT_START_WAIT_MS } from "./control/prompt-start"
import { locateControl } from "./control/locate"
import { answered, closeOptions, closeThread, interruptThread, NOT_LIVE, setModelOn } from "./control/operations"
import { renameThread } from "./control/rename"
import { controlIdentity, controlRefusalOf } from "./control/port"
import { inSendResultOrder } from "./contracts/send-result-order"
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
import type { DeliveryOutcome, DeliveryTarget, RelayDeliverySuccess } from "./gateway/transport"
import type { GatewayDeliveryMode, GatewayDeliveryResult, GatewayDeliverySuccess } from "./gateway/types"
import { createLiveThreadSurface, parseHostStatusAll } from "./live-surface"
import { resolveThreadSocket } from "./live-surface-paths"
import { createGatewayServices } from "./tools/gateway-services"
import { addressBook, hostView, sendAddressBook } from "./tools/internals"
import { UNKNOWN_CALLER, type ThreadHost, type ThreadToolSurfaceOptions } from "./tools/ports"
import { listThreads, readThread, withBacklog } from "./tools/read-ops"
import { listAcross } from "./remote/cross-device"
import { lazySameDeviceWake } from "./wake/lazy-same-device-wake"
import { TOOL_CALL_BUDGET_MS, waitWithinCallBudget, withCallDeadline } from "../call-budget/call-deadline"
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
  /** How long a create waits for its first prompt to start on this device; absent, FIRST_PROMPT_START_WAIT_MS (test seam). */
  readonly firstPromptWaitMs?: number
  readonly now?: () => number
  /**
   * The account's other devices and its alias registry (the CLI passes the thread client sidecar's `createCliRemoteSurface`):
   * `read` then resolves an address exactly as the agent's `thread_read` does. Absent, it reads this device only; the
   * shipped entry (`extension/thread-sdk.ts`) passes the account surface when its caller passes none (#14616).
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
  /** A send to a session on another device (#14616): its device answered; there is no local row, so no `message_seq`. */
  | (Omit<RelayDeliverySuccess, "thread_id"> & { readonly thread: string })
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
  /** `cli:<uid>`: the principal every receipt, budget and send of this SDK is keyed by. */
  readonly principal: string
  /** `state`: the thread states to list; the default lists every state but archived. */
  readonly list: (request?: Scoped & { readonly state?: readonly ThreadState[] }) => Promise<ThreadToolResult>
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
        /** Replaces this sender's earlier undelivered send to the thread under the same key (#14428). */
        readonly collapse_key?: string
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
  // A control's typed refusal (another device's answer included) is the call's answer, as in the tools (#14755).
  const refusal = controlRefusalOf(error)
  if (refusal !== undefined) return { kind: "error", error: refusal }
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
function unknownKeys(request: unknown, known: readonly string[]): Failure | undefined {
  if (typeof request !== "object" || request === null || Array.isArray(request))
    return fail("invalid_arguments", "The options must be an object.", `Pass an object with ${known.join(", ")}.`)
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
const SEND_KEYS = [
  "thread",
  "text",
  "mode",
  "expected_turn_id",
  "all_scope",
  "idempotency_key",
  "collapse_key",
] as const
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
    sameDeviceWake: lazySameDeviceWake({
      options: {},
      store,
      agentDir: () => options.agentDir,
      sessionsDirectory: () => join(options.agentDir, "sessions"),
      cwd: () => options.cwd,
      warn: (line) => process.stderr.write(`${line}\n`),
    }),
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

  // The shared resolver's context, as far as it is fixed for this SDK instance (the local book each call builds
  // is spread in per call). `self` never resolves for the CLI (UNKNOWN_CALLER), exactly as before.
  const resolveContext = (local: readonly ThreadAddressEntry[]) => ({
    remote: options.remote,
    callerWorkspaceRoot: surface.callerWorkspaceRoot(),
    local,
    callerId: UNKNOWN_CALLER,
  })

  function named(sent: DeliveryOutcome): ThreadSdkSendResult {
    if (sent.kind !== "ok") return sent
    const { thread_id, ...facts } = sent
    return inSendResultOrder({ ...facts, thread: thread_id })
  }

  return {
    registerStoreExtension: store.registerStoreExtension,
    extensionCall: store.extensionCall,
    principal,
    list: (request = {}) =>
      guarded(
        async () =>
          unknownKeys(request, LIST_KEYS) ??
          listAcross(
            options.remote,
            await withBacklog(surface.store, listThreads(surface, await view(), request.all_scope, request.state)),
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
        // The engine admits a command-line delivery only from its own machine, so a send to another device goes the way
        // `omo remote send` does: this person's own input, a prompt keyed by the person principal (#14616). The process runs
        // as that same user with the same device service, so it reaches nothing that command could not.
        const remote = target.kind === "remote"
        const sent = await pipeline.deliver({
          sender: { kind: remote ? "person" : "cli", uid: options.uid, user: options.user },
          caller_id: remote ? `person:${options.uid}` : principal,
          target,
          text: request.text,
          mode: request.mode ?? DEFAULT_THREAD_DELIVERY,
          ...(request.expected_turn_id === undefined ? {} : { expected_turn_id: String(request.expected_turn_id) }),
          idempotency_key: request.idempotency_key ?? `auto:${randomUUID()}`,
          ...(request.collapse_key === undefined ? {} : { collapse_key: request.collapse_key }),
          args: request,
        })
        return named(sent)
      }),
    locate: (request) =>
      guarded(async () => {
        const refused = unknownKeys(request, LOCATE_KEYS)
        if (refused !== undefined) return refused
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
              mode: send.delivery ?? DEFAULT_THREAD_DELIVERY,
              idempotency_key: key,
              args: send,
              authority: "creator",
            })
            if (sent.kind === "error") return { kind: "error", error: sent.error }
            const { thread_id, ...facts } = sent
            return { ...facts, thread: thread_id } as ThreadToolResult
          },
          awaitPromptStart: (deliveryId) =>
            awaitPromptStart(
              store,
              deliveryId,
              waitWithinCallBudget(
                options.firstPromptWaitMs ?? FIRST_PROMPT_START_WAIT_MS,
                FIRST_PROMPT_START_RESERVE_MS,
              ),
            ),
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
        return await closeThread(found.control, closeOptions(value))
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

const HERE_PREFIX = "here/"

/** The thread part of a `here/<thread>` address, for building the local book: a session file answers a bare id. */
const bareOf = (address: string): string =>
  address.startsWith(HERE_PREFIX) ? address.slice(HERE_PREFIX.length) : address
