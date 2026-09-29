import { randomUUID } from "node:crypto"

import type { AddressEntry } from "./address-book"
import type { ThreadToolResult } from "./contracts"
import { threadToolFailure, type ThreadToolFailure } from "./errors"
import type { ReleaseSessionReply, ReleaseSessionRequest } from "./gateway/adapter"
import { type BindInput, OUTBOUND_EVENTS, type OutboundEvent } from "./gateway/bindings"
import type { GatewayRelay } from "./gateway/relay"
import { createGatewayStore, type GatewayStore } from "./gateway/store"
import type { GatewayDeliveryMode, GatewayDeliveryResult } from "./gateway/types"
import { createLiveThreadSurface, parseHostStatusAll } from "./live-surface"
import { createGatewayServices } from "./tools/gateway-services"
import { addressBook, hostView, resolution, resolveEntries } from "./tools/internals"
import { UNKNOWN_CALLER, type ThreadHost, type ThreadToolSurfaceOptions } from "./tools/ports"
import { listThreads, readThread } from "./tools/read-ops"

export type ThreadSdkOptions = {
  readonly agentDir: string
  /** The caller's working directory: the workspace a call without `all_scope` is scoped to. */
  readonly cwd: string
  readonly uid: number
  readonly user: string
  readonly env?: Readonly<Record<string, string | undefined>>
  /** The engine's `host status --all --include-workers --json` stdout; the caller owns how the engine is run. */
  readonly engineStatusAll?: () => Promise<string | undefined>
  /** Where the store worker sidecar is resolved from when this SDK is not loaded from `omo.js`. */
  readonly workerModuleUrl?: string | URL
  readonly host?: ThreadHost
  readonly store?: GatewayStore
  readonly now?: () => number
}

type Failure = { readonly kind: "error"; readonly error: ThreadToolFailure }
type Scoped = { readonly all_scope?: boolean }
type Keyed = { readonly idempotency_key?: string }
type Relayed<K extends keyof GatewayRelay> = Promise<Awaited<ReturnType<GatewayRelay[K]>> | Failure>

/** Where a session lives right now, as `omo daemon adopt` needs it. */
export type LocatedThread = Pick<AddressEntry, "thread_id" | "title" | "cwd" | "status" | "session_path" | "endpoint" | "surface" | "alive">

export type ThreadSdk = {
  /** `cli:<uid>`: the principal every receipt, budget and bindingless send of this SDK is keyed by. */
  readonly principal: string
  readonly list: (request: Scoped) => Promise<ThreadToolResult>
  readonly read: (request: Scoped & { readonly thread: string; readonly max_bytes?: number; readonly cursor?: string }) => Promise<ThreadToolResult>
  /** Bindingless: the `cli` sender. With `binding_id`: the connector inbound path (the binding's mode, `event:<key>` admitted once). */
  readonly send: (request: Scoped & Keyed & { readonly thread?: string; readonly text: string; readonly mode?: GatewayDeliveryMode; readonly expected_turn_id?: number; readonly binding_id?: string }) => Promise<GatewayDeliveryResult>
  readonly bind: (request: Scoped & Keyed & { readonly session: string; readonly binding: Omit<BindInput, "session_durable_id"> }) => Relayed<"bind">
  readonly unbind: (request: Keyed & { readonly binding_id: string; readonly expected_revision: number }) => Relayed<"unbind">
  readonly rebind: (request: Scoped & Keyed & { readonly binding_id: string; readonly expected_revision: number; readonly session: string }) => Relayed<"rebind">
  readonly bindings: (request: Scoped & { readonly session?: string; readonly platform?: string; readonly account_id?: string; readonly chat_id?: string; readonly thread_id?: string; readonly status?: string; readonly cursor?: string; readonly limit?: number }) => Relayed<"bindings">
  readonly report: (request: Scoped & Keyed & { readonly session: string; readonly kind: string; readonly text: string; readonly binding_id?: string; readonly request_id?: string }) => Relayed<"report">
  readonly outbox: (request: { readonly binding_id: string; readonly after_cursor?: number; readonly limit?: number }) => Relayed<"outbox">
  readonly ack: (request: { readonly binding_id: string; readonly cursor: number; readonly provider_message_id?: string }) => Relayed<"ack">
  readonly answer: (request: { readonly binding_id: string; readonly reply_token: string; readonly answer: string }) => Relayed<"answer">
  readonly locate: (request: Scoped & { readonly thread: string }) => Promise<{ readonly kind: "ok"; readonly thread: LocatedThread } | Failure>
  /** senpi `release_session` on the host that serves `thread`; a thrown transport failure is answered as `host_unavailable`. */
  readonly release: (thread: LocatedThread, request: Omit<ReleaseSessionRequest, "reason">) => Promise<ReleaseSessionReply>
  readonly dispose: () => Promise<void>
}

function fail(code: Parameters<typeof threadToolFailure>[0], message: string, next: string, details?: Readonly<Record<string, unknown>>): Failure {
  return { kind: "error", error: threadToolFailure(code, message, next, details) }
}

/** The same mapping the tools apply to a thrown surface failure, so a script sees data, never a stack. */
function thrown(error: unknown): Failure {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith("host_unavailable:")) return fail("host_unavailable", `The thread host is unavailable at ${message.slice("host_unavailable:".length)}.`, "Retry when a host or terminal session is running.")
  if (message.startsWith("unsupported:")) return fail("unsupported", `The target's endpoint does not accept ${message.slice("unsupported:".length)}.`, "Use thread read to follow the session.", { command: message.slice("unsupported:".length) })
  return fail("internal_error", `Thread operation failed: ${message}`, "Run omo thread list and retry after checking the target.")
}

async function guarded<T>(body: () => Promise<T>): Promise<T | Failure> {
  try {
    return await body()
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
  const now = options.now ?? Date.now
  const principal = `cli:${options.uid}`
  const env = { ...(options.env ?? process.env), OMO_CODING_AGENT_DIR: options.agentDir }
  const engineStatusAll = options.engineStatusAll
  const host = options.host ?? createLiveThreadSurface(undefined, {
    env,
    ...(engineStatusAll === undefined ? {} : { statusAll: async () => parseHostStatusAll(await engineStatusAll()) }),
  })
  const store = options.store ?? createGatewayStore({ agentDir: options.agentDir, ...(options.workerModuleUrl === undefined ? {} : { workerModuleUrl: options.workerModuleUrl }) })
  const surface: ThreadToolSurfaceOptions = { host, store, stateDirectory: options.agentDir, callerSessionId: () => UNKNOWN_CALLER, callerWorkspaceRoot: () => options.cwd, now }
  const view = () => hostView(surface)
  const { engine, relay } = createGatewayServices(surface, view)

  async function sessionId(address: string, allScope: boolean | undefined): Promise<{ readonly id: string } | Failure> {
    const resolved = resolution(surface, resolveEntries(surface, await view()), address, UNKNOWN_CALLER, allScope)
    return resolved.kind === "error" ? { kind: "error", error: resolved } : { id: resolved.entry.thread_id }
  }

  async function inbound(request: Parameters<ThreadSdk["send"]>[0] & { readonly binding_id: string }): Promise<GatewayDeliveryResult> {
    if (request.thread !== undefined) {
      const binding = await store.bindingView({ now: now(), binding_id: request.binding_id })
      const target = await sessionId(request.thread, request.all_scope)
      if ("kind" in target) return target
      if (binding !== null && binding.session_durable_id !== target.id) {
        return fail("invalid_arguments", `Binding ${binding.binding_id} delivers to session ${binding.session_durable_id}, not ${target.id}.`, "Drop the target (the binding names its session) or pass the binding of that session.", { binding_id: binding.binding_id, session: binding.session_durable_id })
      }
    }
    return await relay.inbound({ binding_id: request.binding_id, event_id: request.idempotency_key ?? randomUUID(), text: request.text })
  }

  return {
    principal,
    list: (request) => guarded(async () => listThreads(surface, await view(), request.all_scope)),
    read: (request) => guarded(async () => readThread(surface, await view(), { thread: request.thread, max_bytes: request.max_bytes, cursor: request.cursor, all_scope: request.all_scope }, UNKNOWN_CALLER)),
    send: (request) => guarded(async () => {
      if (request.binding_id !== undefined) return await inbound({ ...request, binding_id: request.binding_id })
      if (request.thread === undefined) return fail("invalid_arguments", "A send without a binding needs a target session.", "Pass the target session, or --binding to deliver through a binding.")
      return await engine.deliver({
        sender: { kind: "cli", uid: options.uid, user: options.user },
        target: request.thread,
        text: request.text,
        ...(request.mode === undefined ? {} : { mode: request.mode }),
        ...(request.expected_turn_id === undefined ? {} : { expected_turn_id: request.expected_turn_id }),
        ...(request.all_scope === undefined ? {} : { all_scope: request.all_scope }),
        ...(request.idempotency_key === undefined ? {} : { idempotency_key: request.idempotency_key }),
      })
    }),
    bind: (request) => guarded(async () => {
      const session = await sessionId(request.session, request.all_scope)
      if ("kind" in session) return session
      return await relay.bind({ principal, ...keyed(request), binding: { ...request.binding, session_durable_id: session.id } })
    }),
    unbind: (request) => guarded(() => relay.unbind({ principal, ...keyed(request), binding_id: request.binding_id, expected_revision: request.expected_revision })),
    rebind: (request) => guarded(async () => {
      const session = await sessionId(request.session, request.all_scope)
      if ("kind" in session) return session
      return await relay.rebind({ principal, ...keyed(request), binding_id: request.binding_id, expected_revision: request.expected_revision, session_durable_id: session.id })
    }),
    bindings: (request) => guarded(async () => {
      const { session: address, all_scope: allScope, cursor, limit, ...filter } = request
      const session = address === undefined ? undefined : await sessionId(address, allScope)
      if (session !== undefined && "kind" in session) return session
      return await relay.bindings({ filter: { ...filter, ...(session === undefined ? {} : { session_durable_id: session.id }) }, ...(cursor === undefined ? {} : { cursor }), ...(limit === undefined ? {} : { limit }) })
    }),
    report: (request) => guarded(async () => {
      const event = OUTBOUND_EVENTS.find((candidate): candidate is OutboundEvent => candidate === request.kind)
      if (event === undefined) return fail("invalid_arguments", `The report kind must be one of ${OUTBOUND_EVENTS.join(", ")}.`, "Pass milestone, report, question or completion.")
      const session = await sessionId(request.session, request.all_scope)
      if ("kind" in session) return session
      return await relay.report({
        principal,
        ...keyed(request),
        session_durable_id: session.id,
        event,
        text: request.text,
        ...(request.binding_id === undefined ? {} : { binding_id: request.binding_id }),
        ...(request.request_id === undefined ? {} : { request_id: request.request_id }),
      })
    }),
    outbox: (request) => guarded(() => relay.outbox(request)),
    ack: (request) => guarded(() => relay.ack(request)),
    answer: (request) => guarded(() => relay.answer(request)),
    locate: (request) => guarded(async () => {
      const current = await view()
      const resolved = resolution(surface, resolveEntries(surface, current), request.thread, UNKNOWN_CALLER, request.all_scope)
      if (resolved.kind === "error") return { kind: "error", error: resolved } as const
      const entries = addressBook(surface, current).filter((entry) => entry.thread_id === resolved.entry.thread_id)
      const entry = entries.find((candidate) => candidate.alive) ?? entries[0]
      if (entry === undefined) return fail("not_found", `Thread ${resolved.entry.thread_id} is not in the address book.`, "Run omo thread list --all-scope.")
      const { thread_id, title, cwd, status, session_path, endpoint, surface: where, alive } = entry
      return { kind: "ok", thread: { thread_id, title, cwd, status, session_path, endpoint, surface: where, alive } } as const
    }),
    release: async (thread, request) => {
      const releaseSession = host.gateway?.releaseSession
      if (releaseSession === undefined || thread.endpoint === null) return { success: false, error: "release_unsupported" }
      try {
        return await releaseSession(thread.endpoint, { reason: "takeover", ...request })
      } catch (error) {
        const failure = thrown(error)
        return { success: false, error: failure.error.code, errorData: { hint: failure.error.message } }
      }
    },
    dispose: () => {
      relay.dispose()
      return store.dispose()
    },
  }
}

function keyed(request: Keyed): Keyed {
  return request.idempotency_key === undefined ? {} : { idempotency_key: request.idempotency_key }
}
