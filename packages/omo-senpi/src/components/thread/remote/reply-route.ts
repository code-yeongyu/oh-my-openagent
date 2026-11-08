// senpi `client-message-identity.ts`: a clientMessageId is 1-256 characters.
const CLIENT_MESSAGE_ID_MAX = 256
const ROUTE_PREFIX = "omo-peer.v1:"
const ROUTED_KEPT = 256

export type ReplyRoute = { readonly device: string; readonly session: string; readonly delivery: string; readonly root: string; readonly hop: number }

/**
 * The route a peer send carries as its prompt's `clientMessageId`, a structured RPC field that text typed into the
 * receiving session cannot produce. Undefined when it would not fit senpi's limit.
 */
export function replyRouteToken(route: ReplyRoute): string | undefined {
  const token = ROUTE_PREFIX + Buffer.from(JSON.stringify({ d: route.device, s: route.session, i: route.delivery, r: route.root, h: route.hop })).toString("base64url")
  return token.length <= CLIENT_MESSAGE_ID_MAX ? token : undefined
}

const field = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 && value.length <= CLIENT_MESSAGE_ID_MAX ? value : undefined)

export function parseReplyRoute(clientMessageId: unknown): ReplyRoute | undefined {
  if (typeof clientMessageId !== "string" || !clientMessageId.startsWith(ROUTE_PREFIX) || clientMessageId.length > CLIENT_MESSAGE_ID_MAX) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(clientMessageId.slice(ROUTE_PREFIX.length), "base64url").toString("utf8"))
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const { d, s, i, r, h } = parsed as Record<string, unknown>
  const device = field(d)
  const session = field(s)
  const delivery = field(i)
  const root = field(r)
  if (device === undefined || session === undefined || delivery === undefined || root === undefined) return undefined
  if (typeof h !== "number" || !Number.isSafeInteger(h) || h < 1) return undefined
  return { device, session, delivery, root, hop: h }
}

type EngineMessage = { readonly role?: unknown; readonly content?: unknown; readonly clientMessageId?: unknown }

function textOf(content: unknown): string | undefined {
  if (typeof content === "string") return content.length > 0 ? content : undefined
  if (!Array.isArray(content)) return undefined
  const parts = content.flatMap((part) => {
    const block = part as { readonly type?: unknown; readonly text?: unknown } | null
    return block?.type === "text" && typeof block.text === "string" ? [block.text] : []
  })
  const text = parts.join("\n")
  return text.length > 0 ? text : undefined
}

export type ReplyRouter = {
  readonly noteMessage: (message: EngineMessage) => void
  readonly noteSend: (thread: string) => void
  readonly settled: (sessionId: string | undefined) => void
  readonly close: () => void
}

/**
 * The receiving half of a cross-device thread_send: when this session's run consumed a peer send that carries a reply
 * route, the run's answer is delivered back to the sender's session at the run's settle. A reply never carries a route,
 * so a reply is never answered by a reply; each delivery is answered at most once per session lifetime.
 */
export function createReplyRouter(deliver: (route: ReplyRoute, answer: string | undefined, sessionId: string) => void): ReplyRouter {
  const pending = new Map<string, ReplyRoute>()
  const routed: string[] = []
  const sentTo = new Set<string>()
  let answer: string | undefined
  let closed = false
  const markRouted = (delivery: string): void => {
    routed.push(delivery)
    if (routed.length > ROUTED_KEPT) routed.shift()
  }
  const reset = (): void => {
    pending.clear()
    sentTo.clear()
    answer = undefined
  }
  return {
    noteMessage: (message) => {
      if (closed) return
      if (message.role === "assistant") {
        answer = textOf(message.content) ?? answer
        return
      }
      if (message.role !== "user") return
      const route = parseReplyRoute(message.clientMessageId)
      if (route === undefined || routed.includes(route.delivery) || pending.has(route.delivery)) return
      pending.set(route.delivery, route)
      answer = undefined
    },
    noteSend: (thread) => {
      if (!closed) sentTo.add(thread)
    },
    settled: (sessionId) => {
      if (closed) return
      const routes = [...pending.values()]
      const text = answer
      const answeredExplicitly = new Set(sentTo)
      reset()
      for (const route of routes) {
        markRouted(route.delivery)
        // The run answered the sender itself with thread_send: that message was the reply.
        if (answeredExplicitly.has(route.session) || sessionId === undefined) continue
        deliver(route, text, sessionId)
      }
    },
    close: () => {
      closed = true
      reset()
    },
  }
}
