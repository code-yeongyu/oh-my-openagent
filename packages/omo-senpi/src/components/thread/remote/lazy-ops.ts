import type { SenpiExtensionAPI } from "../../../extension/types"
import type { Provenance } from "../gateway/types"
import type * as CrossDevice from "./cross-device"
import type { RemoteThreadSurface } from "./ports"
import { createReplyRouter, type ReplyRoute } from "./reply-route"
import type * as RemoteOps from "./remote-ops"
import type * as ReplyAdmit from "./reply-admit"
import type * as RemoteControls from "./remote-controls"

type Runtime = Pick<typeof CrossDevice, "crossTarget" | "listAcross" | "planCreate" | "renameAlias" | "withAlias"> & Pick<typeof RemoteOps, "closeRemote" | "deviceOnline" | "interruptRemote" | "outcomeFailure" | "promptRemote" | "readRemote"> & Pick<typeof ReplyAdmit, "admitReplyRemote"> & Pick<typeof RemoteControls, "setModelRemote">

// The cross-device half ships in the thread client sidecar (`#omo-thread-client-runtime`), which every thread
// operation already loads for the live host, so `omo.js` carries none of it.
const runtime = (): Promise<Runtime> => import("#omo-thread-client-runtime")

export const crossTarget = async (...args: Parameters<Runtime["crossTarget"]>) => await (await runtime()).crossTarget(...args)
export const listAcross = async (...args: Parameters<Runtime["listAcross"]>) => await (await runtime()).listAcross(...args)
export const planCreate = async (...args: Parameters<Runtime["planCreate"]>) => await (await runtime()).planCreate(...args)
export const renameAlias = async (...args: Parameters<Runtime["renameAlias"]>) => await (await runtime()).renameAlias(...args)
export const withAlias = async (...args: Parameters<Runtime["withAlias"]>) => await (await runtime()).withAlias(...args)
export const closeRemote = async (...args: Parameters<Runtime["closeRemote"]>) => await (await runtime()).closeRemote(...args)
export const deviceOnline = async (...args: Parameters<Runtime["deviceOnline"]>) => await (await runtime()).deviceOnline(...args)
export const interruptRemote = async (...args: Parameters<Runtime["interruptRemote"]>) => await (await runtime()).interruptRemote(...args)
export const outcomeFailure = async (...args: Parameters<Runtime["outcomeFailure"]>) => (await runtime()).outcomeFailure(...args)
export const promptRemote = async (...args: Parameters<Runtime["promptRemote"]>) => await (await runtime()).promptRemote(...args)
export const setModelRemote = async (...args: Parameters<Runtime["setModelRemote"]>) => await (await runtime()).setModelRemote(...args)
export const readRemote = async (...args: Parameters<Runtime["readRemote"]>) => await (await runtime()).readRemote(...args)

export type ReplyRouteOptions = {
  readonly senderProvenance: () => Promise<Provenance>
  readonly sessionName?: () => string | undefined
  readonly warn: (line: string) => void
}

const messageOf = (event: unknown): Record<string, unknown> | undefined => {
  const message = (event as { readonly message?: unknown } | undefined)?.message
  return typeof message === "object" && message !== null ? (message as Record<string, unknown>) : undefined
}

const sessionIdOf = (ctx: unknown): string | undefined => {
  const id = (ctx as { readonly sessionManager?: { readonly getSessionId?: () => unknown } } | undefined)?.sessionManager?.getSessionId?.()
  return typeof id === "string" && id.length > 0 ? id : undefined
}

/**
 * Answers this session's cross-device peer sends back into each sender's session (reply-route.ts), from this session's own
 * events only. The delivery itself loads the sidecar; a session that never consumes a routed input never loads it.
 */
export function wireReplyRoutes(pi: Pick<SenpiExtensionAPI, "on">, remote: RemoteThreadSurface, options: ReplyRouteOptions): void {
  const failed = (route: ReplyRoute, reason: string): void => options.warn(`remote_reply_failed: the answer to delivery ${route.delivery} was not delivered to session ${route.session} on device ${route.device} (${reason}).`)
  // One delivery at a time, in settle order, so answers reach the sender in the order the runs made them.
  let queue: Promise<void> = Promise.resolve()
  const router = createReplyRouter((route, reply, sessionId, answered) => {
    queue = queue.then(async () => {
      if (sessionId === undefined) return failed(route, "the settled run named no session id")
      if (reply.mixed && reply.answer === undefined) return options.warn(`remote_reply_skipped: delivery ${route.delivery} from session ${route.session} on device ${route.device} got no answer of its own before the run took another input; nothing was sent, so no answer to another input reaches that peer.`)
      const name = options.sessionName?.()
      const outcome = await (await runtime()).admitReplyRemote(remote, route, { session_id: sessionId, provenance: await options.senderProvenance(), ...(name === undefined ? {} : { name }) }, reply.answer, answered)
      if (outcome.kind === "unavailable") options.warn(`${outcome.code}: the answer to delivery ${route.delivery} was not delivered to session ${route.session} on device ${route.device}: its engine cannot admit a peer delivery (${outcome.reason}); update omo and senpi on that device.`)
      else if (outcome.kind === "failed") failed(route, outcome.reason)
    }).catch((error: unknown) => failed(route, error instanceof Error ? error.message : String(error)))
  })
  pi.on("message_start", (event) => {
    const message = messageOf(event)
    if (message?.["role"] === "user" || message?.["role"] === "custom") router.noteMessage(message)
  })
  pi.on("message_end", (event) => {
    const message = messageOf(event)
    if (message?.["role"] === "assistant") router.noteMessage(message)
  })
  // A thread_send that succeeded, by the session it resolved to: a name or alias for the sender counts as well as its id.
  pi.on("tool_execution_end", (event) => {
    const { toolName, isError, result } = (event ?? {}) as { readonly toolName?: unknown; readonly isError?: unknown; readonly result?: { readonly details?: { readonly result?: { readonly kind?: unknown; readonly thread_id?: unknown; readonly device?: unknown } } } }
    const sent = result?.details?.result
    if (toolName === "thread_send" && isError !== true && sent?.kind === "ok" && typeof sent.thread_id === "string" && typeof sent.device === "string") router.noteSend({ device: sent.device, thread: sent.thread_id })
  })
  pi.on("agent_settled", (_event, ctx) => router.settled(sessionIdOf(ctx)))
  pi.on("session_shutdown", () => router.close())
}
