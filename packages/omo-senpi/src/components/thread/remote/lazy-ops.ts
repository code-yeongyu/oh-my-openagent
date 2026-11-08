import type { SenpiExtensionAPI } from "../../../extension/types"
import type { Provenance } from "../gateway/types"
import type * as CrossDevice from "./cross-device"
import type { RemoteThreadSurface } from "./ports"
import { createReplyRouter } from "./reply-route"
import type * as RemoteOps from "./remote-ops"
import type * as RemoteControls from "./remote-controls"

type Runtime = Pick<typeof CrossDevice, "crossTarget" | "listAcross" | "planCreate" | "renameAlias" | "withAlias"> & Pick<typeof RemoteOps, "closeRemote" | "deviceOnline" | "interruptRemote" | "outcomeFailure" | "promptRemote" | "readRemote" | "admitReplyRemote"> & Pick<typeof RemoteControls, "setModelRemote">

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
  const router = createReplyRouter((route, answer, sessionId) => {
    void (async () => {
      const name = options.sessionName?.()
      const outcome = await (await runtime()).admitReplyRemote(remote, route, { session_id: sessionId, provenance: await options.senderProvenance(), ...(name === undefined ? {} : { name }) }, answer)
      if (outcome.kind === "unavailable") options.warn(`${outcome.code}: the answer to delivery ${route.delivery} was not delivered to session ${route.session} on device ${route.device}: its engine cannot admit a peer delivery (${outcome.reason}); update omo and senpi on that device.`)
      else if (outcome.kind === "failed") options.warn(`remote_reply_failed: the answer to delivery ${route.delivery} was not delivered to session ${route.session} on device ${route.device} (${outcome.reason}).`)
    })().catch((error: unknown) => options.warn(`remote_reply_failed: the answer to delivery ${route.delivery} was not delivered to session ${route.session} on device ${route.device} (${error instanceof Error ? error.message : String(error)}).`))
  })
  pi.on("message_start", (event) => {
    const message = messageOf(event)
    if (message?.["role"] === "user") router.noteMessage(message)
  })
  pi.on("message_end", (event) => {
    const message = messageOf(event)
    if (message?.["role"] === "assistant") router.noteMessage(message)
  })
  pi.on("tool_execution_start", (event) => {
    const { toolName, args } = (event ?? {}) as { readonly toolName?: unknown; readonly args?: { readonly thread?: unknown } }
    if (toolName === "thread_send" && typeof args?.thread === "string") router.noteSend(args.thread)
  })
  pi.on("agent_settled", (_event, ctx) => router.settled(sessionIdOf(ctx)))
  pi.on("session_shutdown", () => router.close())
}
