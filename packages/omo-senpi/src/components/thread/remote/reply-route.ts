// senpi `client-message-identity.ts`: a clientMessageId is 1-256 characters.
const CLIENT_MESSAGE_ID_MAX = 256
const ROUTE_PREFIX = "omo-peer.v1:"
const ROUTE_VERSION = 1
const ROUTED_KEPT = 256
// memory/recall-session-read.ts RECALL_CUSTOM_TYPE, by value: importing memory here would pull its prompt module into
// the thread bundles. reply-route.test.ts compares against that constant, so a rename there fails the test.
const MEMORY_RECALL_CUSTOM_TYPE = "omo-kibitzer:recall"
// senpi's own delivery entry: another party's input wherever it lands in a turn.
const DELIVERY_CUSTOM_TYPE = "session_control_delivery"
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const HOP = /^[1-9][0-9]{0,15}$/
const FIELD_UUID = 0
const FIELD_TEXT = 1

export type ReplyRoute = { readonly device: string; readonly session: string; readonly delivery: string; readonly root: string; readonly hop: number }

function writeField(out: number[], value: string): boolean {
  if (UUID.test(value)) {
    out.push(FIELD_UUID, ...Buffer.from(value.replaceAll("-", ""), "hex"))
    return true
  }
  const bytes = Buffer.from(value, "utf8")
  if (bytes.length === 0 || bytes.length > 255) return false
  out.push(FIELD_TEXT, bytes.length, ...bytes)
  return true
}

/**
 * The route a peer send carries as its prompt's `clientMessageId`, a structured RPC field that text typed into the
 * receiving session cannot produce. Ids shaped as lowercase UUIDs travel as their 16 bytes, so the route keeps its
 * margin under senpi's limit. Undefined when it would not fit.
 */
export function replyRouteToken(route: ReplyRoute): string | undefined {
  const out = [ROUTE_VERSION]
  for (const value of [route.device, route.session, route.delivery, route.root, String(route.hop)]) if (!writeField(out, value)) return undefined
  const token = ROUTE_PREFIX + Buffer.from(out).toString("base64url")
  return token.length <= CLIENT_MESSAGE_ID_MAX ? token : undefined
}

const utf8 = new TextDecoder("utf-8", { fatal: true })

function readFields(bytes: Buffer): string[] | undefined {
  const fields: string[] = []
  let at = 1
  while (at < bytes.length) {
    const tag = bytes[at]
    if (tag === FIELD_UUID && at + 17 <= bytes.length) {
      const hex = bytes.subarray(at + 1, at + 17).toString("hex")
      fields.push(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`)
      at += 17
    } else if (tag === FIELD_TEXT && at + 2 <= bytes.length) {
      const length = bytes[at + 1] ?? 0
      if (length === 0 || at + 2 + length > bytes.length) return undefined
      try {
        fields.push(utf8.decode(bytes.subarray(at + 2, at + 2 + length)))
      } catch {
        return undefined
      }
      at += 2 + length
    } else return undefined
  }
  return fields
}

export function parseReplyRoute(clientMessageId: unknown): ReplyRoute | undefined {
  if (typeof clientMessageId !== "string" || !clientMessageId.startsWith(ROUTE_PREFIX) || clientMessageId.length > CLIENT_MESSAGE_ID_MAX) return undefined
  const bytes = Buffer.from(clientMessageId.slice(ROUTE_PREFIX.length), "base64url")
  if (bytes[0] !== ROUTE_VERSION) return undefined
  const fields = readFields(bytes)
  if (fields?.length !== 5) return undefined
  const [device, session, delivery, root, hop] = fields as [string, string, string, string, string]
  if (!HOP.test(hop) || !Number.isSafeInteger(Number(hop))) return undefined
  return { device, session, delivery, root, hop: Number(hop) }
}

type EngineMessage = { readonly role?: unknown; readonly content?: unknown; readonly clientMessageId?: unknown; readonly customType?: unknown }

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

/** A thread_send the run made that succeeded, by the session it resolved to (its result's `thread_id` and `device`). */
export type SentTarget = { readonly device: string; readonly thread: string }

/**
 * What a route's own input got: the last answer the model gave before the next input arrived, and the sends made while
 * answering it. `mixed`: the route's input shares an answer with another input (one arrived before the route's final
 * answer, or the route steered into a run whose earlier input had none yet), so nothing can be attributed to it.
 */
export type RouteReply = { readonly answer: string | undefined; readonly mixed: boolean; readonly sent: readonly SentTarget[] }

export type ReplyRouter = {
  readonly noteMessage: (message: EngineMessage) => void
  readonly noteSend: (target: SentTarget) => void
  readonly settled: (sessionId: string | undefined) => void
  readonly close: () => void
}

type Segment = { readonly route: ReplyRoute; answer: string | undefined; final: boolean; mixed: boolean; readonly sent: SentTarget[] }

const callsTools = (content: unknown): boolean => Array.isArray(content) && content.some((part) => (part as { readonly type?: unknown } | null)?.type === "toolCall")

/**
 * The receiving half of a cross-device thread_send: when this session's run consumed a peer send that carries a reply
 * route, the answer to THAT input (the model's output before the run's next input, the repo's mixed-input rule) goes
 * back to the sender's session at the run's settle. Output that followed the local user's input or another party's
 * input is never sent to a peer. A reply never carries a route, so a reply is never answered by a reply, and each
 * delivery is answered at most once per session lifetime.
 */
export function createReplyRouter(deliver: (route: ReplyRoute, reply: RouteReply, sessionId: string | undefined) => void): ReplyRouter {
  const segments: Segment[] = []
  const routed: string[] = []
  let current: Segment | undefined
  // The run's latest input (any kind) has had a final answer: an assistant message that calls no tool.
  let inputAnswered = true
  // An assistant message has followed the run's latest input (or the run's start): a custom before it is turn-start context.
  let assistantSinceInput = false
  let closed = false
  const markRouted = (delivery: string): void => {
    routed.push(delivery)
    if (routed.length > ROUTED_KEPT) routed.shift()
  }
  const endCurrent = (): void => {
    if (current !== undefined && !current.final) current.mixed = true
    current = undefined
  }
  const reset = (): void => {
    segments.length = 0
    current = undefined
    inputAnswered = true
    assistantSinceInput = false
  }
  return {
    noteMessage: (message) => {
      if (closed) return
      if (message.role === "assistant") {
        assistantSinceInput = true
        const final = !callsTools(message.content)
        if (final) inputAnswered = true
        if (current === undefined) return
        current.answer = textOf(message.content) ?? current.answer
        if (final) current.final = true
        return
      }
      // A user message and another party's delivery are always inputs. Any other custom (a ulw-loop continuation, a task
      // completion) is an input once an assistant message followed the latest input; before that it is turn-start context
      // senpi writes with the turn (the environment context, the memory notice, the task usage hint). The memory recall is
      // context the session gives itself and never an input.
      const custom = message.role === "custom" && message.customType !== MEMORY_RECALL_CUSTOM_TYPE
      const input = message.role === "user" || (custom && (message.customType === DELIVERY_CUSTOM_TYPE || assistantSinceInput))
      if (!input) return
      assistantSinceInput = false
      const earlierOpen = !inputAnswered
      endCurrent()
      inputAnswered = false
      const route = message.role === "user" ? parseReplyRoute(message.clientMessageId) : undefined
      if (route === undefined || routed.includes(route.delivery) || segments.some((segment) => segment.route.delivery === route.delivery)) return
      current = { route, answer: undefined, final: false, mixed: earlierOpen, sent: [] }
      segments.push(current)
    },
    noteSend: (target) => {
      if (!closed) current?.sent.push(target)
    },
    settled: (sessionId) => {
      if (closed) return
      // A mixed route carries no answer at all, so nothing given to another input can travel past this point.
      const done = segments.map((segment) => {
        const mixed = segment.mixed || !segment.final
        return { route: segment.route, reply: { answer: mixed ? undefined : segment.answer, mixed, sent: [...segment.sent] } }
      })
      reset()
      for (const { route, reply } of done) {
        markRouted(route.delivery)
        deliver(route, reply, sessionId)
      }
    },
    close: () => {
      closed = true
      reset()
    },
  }
}
