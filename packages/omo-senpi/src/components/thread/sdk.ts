import type { WarmAnswer } from "../../../../senpi-task/src/runners/rpc-host/host-warm-reply"

import { assembleForFacade } from "../omo-sdk/assembly"
import type { OmoFailure } from "../omo-sdk/contract"
import { storeRefusal } from "../omo-sdk/root/extension-codes"
import { threadToolFailureOf } from "../omo-sdk/root/thread-failures"
import {
  parseThreadParams,
  unknownKeys,
  threadToolParamSchemas,
  type ThreadCloseInput,
  type ThreadCreateInput,
  type ThreadInterruptInput,
  type ThreadRenameInput,
  type ThreadSetModelInput,
  type ThreadState,
  type ThreadToolResult,
} from "./contracts"
import type { ReleaseSessionReply, ReleaseSessionRequest } from "./gateway/adapter"
import type { StoreExtensionApi, StoreExtensionRegistration } from "./gateway/store-extensions"
import type { RelayDeliverySuccess } from "./gateway/transport"
import type { GatewayDeliveryMode, GatewayDeliveryResult, GatewayDeliverySuccess } from "./gateway/types"
import type { ThreadCoreOptions } from "./sdk-core/context"
import type { Failure } from "./sdk-core/failures"
import type { LocatedThread } from "./sdk-core/reads"
export type {
  StoreExtensionApi,
  StoreExtensionRegistration,
  StoreExtensionTransaction,
  StoreExtensionOperation,
  StoreExtensionResult,
  StoreExtensionRefusal,
  StoreExtensionRefusalCode,
} from "./gateway/store-extensions"
export type { LocatedThread } from "./sdk-core/reads"

export type ThreadSdkOptions = ThreadCoreOptions

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

type Scoped = { readonly all_scope?: boolean }
type Keyed = { readonly idempotency_key?: string }
/** A send's answer: the gateway's delivery facts, with the session named `thread`, the address `read` and `send` take back. */
export type ThreadSdkSendResult =
  | (Omit<GatewayDeliverySuccess, "thread_id"> & { readonly thread: string })
  /** A send to a session on another device (#14616): its device answered; there is no local row, so no `message_seq`. */
  | (Omit<RelayDeliverySuccess, "thread_id"> & { readonly thread: string })
  | Exclude<GatewayDeliveryResult, GatewayDeliverySuccess>

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

/**
 * Each field of the facade's send answer and the field of the root's threads.send answer it projects from (design 4.1,
 * the send amendment). The root's `link` has no facade field, so the facade does not carry it.
 */
export const SEND_PROJECTION = {
  kind: "kind",
  thread: "thread",
  delivery_id: "delivery_id",
  message_seq: "message_seq",
  delivery: "delivery",
  outcome: "outcome",
  effective_mode: "effective_mode",
  endpoint_kind: "endpoint_kind",
  deduplicated: "deduplicated",
  collapsed: "collapsed",
  device: "device",
} as const

const FACADE_FIELD: ReadonlyMap<string, string> = new Map(
  Object.entries(SEND_PROJECTION).map(([facade, root]) => [root, facade]),
)

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

// The facade answers the thread contract's own shapes, which the root's thread calls answer too; a root failure is the
// thread failure it was made from (omo-sdk/root/thread-failures.ts).
function asThreadResult(answer: { readonly kind: string }): ThreadToolResult {
  if (answer.kind !== "error") return answer as ThreadToolResult
  return { kind: "error", error: threadToolFailureOf(answer as OmoFailure) }
}

/**
 * The script-callable thread surface, kept as it shipped (`runtime/thread-sdk/sdk.js`): a compatibility facade over the
 * omo SDK root (first-party design 4.1). Each member maps its fields onto the root's call and its answer back; the root
 * is built for the script principal of `uid`, with the host, store, remote and clock given here.
 */
export function createThreadSdk(options: ThreadSdkOptions): ThreadSdk {
  assertThreadSdkOptions(options)
  const { agentDir, cwd, uid, user, env, host, store, remote, now } = options
  const { provenanceWorkspaces, engineStatusAll, workerModuleUrl, firstPromptWaitMs } = options
  const { root, releaseLocated } = assembleForFacade({
    agentDir,
    cwd,
    uid,
    user,
    ...(env === undefined ? {} : { env }),
    principal: { kind: "script", uid },
    threads: {
      ...(provenanceWorkspaces === undefined ? {} : { provenanceWorkspaces }),
      ...(engineStatusAll === undefined ? {} : { engineStatusAll }),
      ...(workerModuleUrl === undefined ? {} : { workerModuleUrl }),
      ...(firstPromptWaitMs === undefined ? {} : { firstPromptWaitMs }),
    },
    ports: {
      ...(host === undefined ? {} : { host }),
      ...(store === undefined ? {} : { store }),
      ...(remote === undefined ? {} : { remote }),
      ...(now === undefined ? {} : { now }),
    },
  })
  const threads = root.threads
  return {
    registerStoreExtension: async (extension: StoreExtensionRegistration) => {
      const registered = await threads.extensions.register(
        extension as Parameters<typeof threads.extensions.register>[0],
      )
      return registered.kind === "ok" ? registered : storeRefusal(registered)
    },
    extensionCall: async (name, op, args) => {
      const answered = await threads.extensions.call({ name, op, args })
      return answered.kind === "ok" ? (answered as never) : storeRefusal(answered)
    },
    principal: `cli:${uid}`,
    list: async (request = {}) => {
      const refused = unknownKeys(request, LIST_KEYS)
      if (refused !== undefined) return refused
      const { state, ...rest } = request
      return asThreadResult(await threads.list({ ...rest, ...(state === undefined ? {} : { state: [...state] }) }))
    },
    read: async (request) => unknownKeys(request, READ_KEYS) ?? asThreadResult(await threads.read(request)),
    send: async (request) => {
      const refused = unknownKeys(request, SEND_KEYS)
      if (refused !== undefined) return refused
      const { text, mode, expected_turn_id, ...rest } = request
      const sent = await threads.send({
        ...rest,
        message: text,
        ...(mode === undefined ? {} : { delivery: mode }),
        ...(expected_turn_id === undefined ? {} : { expected_turn_id: String(expected_turn_id) }),
      })
      if (sent.kind !== "ok") return { kind: "error", error: threadToolFailureOf(sent as OmoFailure) }
      const projected = Object.entries(sent).flatMap(([field, value]) => {
        const facade = FACADE_FIELD.get(field)
        return facade === undefined ? [] : [[facade, value] as const]
      })
      return Object.fromEntries(projected) as ThreadSdkSendResult
    },
    locate: async (request) => {
      const located = await threads.locate(request)
      return located.kind === "ok"
        ? { kind: "ok", thread: located.located }
        : { kind: "error", error: threadToolFailureOf(located) }
    },
    create: async (request) => {
      // The facade takes the tool's create schema, narrower than the root's: what it refused, it still refuses as it did.
      const parsed = parseThreadParams(threadToolParamSchemas.thread_create, request)
      if (parsed.kind === "error") return parsed as ThreadToolResult
      return asThreadResult(await threads.create(request))
    },
    interrupt: async (request) => asThreadResult(await threads.interrupt(request)),
    close: async (request) => asThreadResult(await threads.close(request)),
    rename: async (request) => asThreadResult(await threads.rename(request)),
    set_model: async (request) => asThreadResult(await threads.setModel(request)),
    release: releaseLocated,
    warmDaemon: async () => {
      const warmed = await root.daemon.warm({})
      if (warmed.kind === "ok") return warmed.value as WarmAnswer
      throw new Error(warmed.error.message)
    },
    dispose: root.dispose,
  }
}
