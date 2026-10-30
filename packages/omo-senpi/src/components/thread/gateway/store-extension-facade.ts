import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

import { awaitSessionRequest } from "./extension-session-await"
import { AWAIT_REQUEST_ID } from "./extension-registrations"
import { gatewayDatabasePath } from "./paths"
import type { SessionCallReply, SessionCallRequest } from "./store-extension-session-ops"
import type { SessionCaller, StoreExtensionApi, StoreExtensionRefusal, StoreExtensionRegistration, StoreExtensionResult, StoreExtensionSessionApi } from "./store-extensions"

/** The worker's registration reply: the caller's result, and whether calls for that name now use this registration. */
export type ExtensionRegisterReply = { readonly result: StoreExtensionResult<{ readonly version: number }>; readonly retained: boolean }

/** A registration the current worker holds, with the time it was made: a restarted worker replays it as of then. */
export type RetainedRegistration = { readonly extension: StoreExtensionRegistration; readonly registeredAt: number }

export type ThreadCreationRecord = { readonly creator_durable_id: string; readonly created_durable_id: string }

export type ExtensionFacade = StoreExtensionApi & StoreExtensionSessionApi & {
  /** The durable record that `creator` thread_create'd `created`; a session op's `caller_created_target` reads it. */
  readonly recordThreadCreation: (record: ThreadCreationRecord) => Promise<void>
}

type FacadeDeps = {
  readonly agentDir: string
  readonly now: () => number
  readonly call: <T>(op: string, args?: unknown) => Promise<T>
  /** The registrations the current worker holds, restored on the next worker after one exits. */
  readonly registrations: Map<string, RetainedRegistration>
  /** Test seam: an await armed its watch and read a non-final status (`awaitSessionRequest` `onArmed`). */
  readonly onAwaitArmed?: (awaitRequestId: string) => void
}

/** A newer core schema refuses extension requests as data; anything else stays an error. */
function schemaTooNew(error: unknown): StoreExtensionRefusal {
  if (error instanceof Error && "code" in error && error.code === "gateway_schema_too_new") {
    return { kind: "refused", code: "gateway_schema_too_new", message: error.message }
  }
  throw error
}

function cloneArgs(args: unknown): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly refusal: StoreExtensionRefusal } {
  try {
    return { ok: true, value: structuredClone(args) }
  } catch (error) {
    return { ok: false, refusal: { kind: "refused", code: "invalid_arguments", message: `Extension arguments are not cloneable: ${error instanceof Error ? error.message : String(error)}` } }
  }
}

/** The store facade's extension surface: the public channel, the session channel and its await, and the creator record. */
export function createExtensionFacade(deps: FacadeDeps): ExtensionFacade {
  const { call, now, registrations } = deps

  async function extensionRequest<T>(op: string, args: unknown): Promise<StoreExtensionResult<T>> {
    try {
      return await call(op, args)
    } catch (error) {
      return schemaTooNew(error)
    }
  }

  async function sessionRequest(name: string, op: string, phase: SessionCallRequest["phase"], args: unknown, caller: SessionCaller): Promise<SessionCallReply> {
    const cloned = cloneArgs(args)
    if (!cloned.ok) return { result: cloned.refusal }
    const request: SessionCallRequest = { name, op, phase, args: cloned.value, caller: caller.callerDurableId, now: now() }
    try {
      return await call<SessionCallReply>("extension_session_call", request)
    } catch (error) {
      return { result: schemaTooNew(error) }
    }
  }

  return {
    registerStoreExtension: async (extension) => {
      let reply: ExtensionRegisterReply
      const registeredAt = now()
      try {
        reply = await call("extension_register", { extension, now: registeredAt })
      } catch (error) {
        return schemaTooNew(error)
      }
      if (reply.retained) registrations.set(extension.name, { extension: structuredClone(extension), registeredAt })
      return reply.result
    },
    extensionCall: async (name, op, args) => {
      const cloned = cloneArgs(args)
      return cloned.ok ? await extensionRequest("extension_call", { name, op, args: cloned.value, now: now() }) : cloned.refusal
    },
    // No store yet means no declarations: answered without opening (and so creating) the store.
    sessionCallableOps: async () => (existsSync(gatewayDatabasePath(deps.agentDir)) ? await call("session_callable_ops") : []),
    extensionSessionAwait: async <T>(name: string, op: string, args: unknown, caller: SessionCaller) => {
      const reply = await sessionRequest(name, op, "op", args, caller)
      const { result } = reply
      if (result.kind !== "ok" || reply.await === undefined) return result as StoreExtensionResult<T>
      const value = result.value as { readonly await_request_id?: unknown } | null
      if (typeof value !== "object" || value === null || value.await_request_id === undefined) return result as StoreExtensionResult<T>
      const id = value.await_request_id
      // Checked before any path is built from it: a traversal attempt never names a file.
      if (typeof id !== "string" || !AWAIT_REQUEST_ID.test(id)) {
        return { kind: "refused", code: "invalid_arguments", message: `await_request_id must match ${AWAIT_REQUEST_ID.source}.` }
      }
      const phase = (which: "status" | "expire") => async () => (await sessionRequest(name, op, which, { await_request_id: id }, caller)).result
      return (await awaitSessionRequest({
        file: join(dirname(gatewayDatabasePath(deps.agentDir)), reply.await.wake_dir, id),
        timeoutMs: reply.await.timeout_ms,
        status: phase("status"),
        expire: phase("expire"),
        ...(deps.onAwaitArmed === undefined ? {} : { onArmed: () => deps.onAwaitArmed?.(id) }),
      })) as StoreExtensionResult<T>
    },
    recordThreadCreation: (record) => call("record_thread_creation", { ...record, now: now() }),
  }
}
