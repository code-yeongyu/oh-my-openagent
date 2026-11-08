import { afterEach, describe, expect, test } from "bun:test"
import type { SenpiExtensionAPI } from "../../../extension/types"
import type { Provenance } from "../gateway/types"
import { createRemoteThreadFixture } from "../thread-remote-fixture"
import { wireReplyRoutes } from "./lazy-ops"
import type { JsonObject, RemoteThreadSurface } from "./ports"
import { createReplyRouter, parseReplyRoute, replyRouteToken, type ReplyRoute } from "./reply-route"

const { account, surface, cleanup } = createRemoteThreadFixture()
afterEach(cleanup)

const B_PROVENANCE: Provenance = { workspace: "work-b", project: "proj-b" }

const within = async <T>(signal: Promise<T>, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`waited 5s for ${label}, it never came`)), 5_000) })
  try { return await Promise.race([signal, timeout]) } finally { clearTimeout(timer) }
}

function session(durableId: string) {
  const handlers = new Map<string, ((payload: unknown, ctx?: unknown) => unknown)[]>()
  const pi = { on: (event: string, handler: (payload: unknown, ctx?: unknown) => unknown) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]) } } as unknown as Pick<SenpiExtensionAPI, "on">
  const ctx = { sessionManager: { getSessionId: () => durableId } }
  const fire = async (event: string, payload: unknown = {}) => { for (const handler of handlers.get(event) ?? []) await handler(payload, ctx) }
  return { pi, fire }
}

function commandSeen(remote: RemoteThreadSurface, type: string): { readonly remote: RemoteThreadSurface; readonly seen: Promise<{ readonly device: string; readonly session: string; readonly rpc: JsonObject }> } {
  let resolve: (value: { device: string; session: string; rpc: JsonObject }) => void = () => {}
  const seen = new Promise<{ device: string; session: string; rpc: JsonObject }>((done) => { resolve = done })
  const sessionCommand: RemoteThreadSurface["sessions"]["sessionCommand"] = async (device, sessionId, rpc, options) => {
    const outcome = await remote.sessions.sessionCommand(device, sessionId, rpc, options)
    if (rpc["type"] === type) resolve({ device, session: sessionId, rpc })
    return outcome
  }
  return { remote: { ...remote, sessions: { ...remote.sessions, sessionCommand } }, seen }
}

describe("a cross-device thread_send is answered back into the sender's session, with no monitor", () => {
  test("#given A sends to B by name and arms no monitor #when B's run on that message settles with an answer #then B delivers one admit_external_message to A's session that starts its turn", async () => {
    const relayA = account()
    const { run } = surface(relayA.remote, { caller: "dur-caller", callerName: () => "agent a" })
    expect(await run("thread_send", { thread: "dur-on-b", message: "what is 2+2?" })).toMatchObject({ kind: "ok", device: "b" })
    const prompt = relayA.sent.find((entry) => entry.rpc?.["type"] === "prompt")?.rpc ?? {}
    const route = parseReplyRoute(prompt["clientMessageId"])
    expect(route).toMatchObject({ device: "here", session: "dur-caller", hop: 1 })

    const relayB = account({ live: ["dur-caller"] })
    const watched = commandSeen(relayB.remote, "admit_external_message")
    const b = session("dur-on-b")
    wireReplyRoutes(b.pi, watched.remote, { senderProvenance: async () => B_PROVENANCE, sessionName: () => "agent b", warn: () => {} })
    await b.fire("message_start", { message: { role: "user", content: [{ type: "text", text: String(prompt["message"]) }], clientMessageId: prompt["clientMessageId"] } })
    await b.fire("message_end", { message: { role: "assistant", content: [{ type: "text", text: "4" }] } })
    await b.fire("agent_settled")
    const delivered = await within(watched.seen, "B's reply delivery")

    expect(delivered.device).toBe("here")
    expect(delivered.session).toBe("dur-caller")
    expect(delivered.rpc).toMatchObject({ type: "admit_external_message", sessionId: "dur-caller", deliveryId: `reply-${route?.delivery}`, deliverAs: "followUp", chainCount: 2, sender: { kind: "agent", session_id: "dur-on-b", name: "agent b" } })
    expect(delivered.rpc["whenIdle"]).toBeUndefined()
    expect(delivered.rpc["remote_origin"]).toBeUndefined()
    expect(delivered.rpc["clientMessageId"]).toBeUndefined()
    const text = String(delivered.rpc["text"])
    expect(text).toContain("source=peer_agent")
    expect(text).toContain("sender_session=dur-on-b")
    expect(text.split("\n").at(-1)).toContain("4")
    expect(relayB.sent.filter((entry) => entry.rpc?.["type"] === "prompt")).toHaveLength(0)
  })

  test("#given A's engine has no admit_external_message #when B routes the reply #then it fails loudly as remote_reply_unavailable and sends no prompt instead", async () => {
    const relayB = account({ live: ["dur-caller"], admitOutcome: { kind: "refused", reason: "unknown_command" } })
    const warned = Promise.withResolvers<string>()
    const b = session("dur-on-b")
    const route: ReplyRoute = { device: "here", session: "dur-caller", delivery: "d-1", root: "d-1", hop: 1 }
    const token = replyRouteToken(route)
    wireReplyRoutes(b.pi, relayB.remote, { senderProvenance: async () => B_PROVENANCE, warn: (line) => warned.resolve(line) })
    await b.fire("message_start", { message: { role: "user", content: "q", clientMessageId: token } })
    await b.fire("message_end", { message: { role: "assistant", content: "a" } })
    await b.fire("agent_settled")

    expect(await within(warned.promise, "the unavailable warning")).toContain("remote_reply_unavailable")
    expect(relayB.sent.map((entry) => entry.rpc?.["type"]).filter((type) => type === "prompt")).toHaveLength(0)
  })
})

describe("bounds: only a routed input's own run answers, once, and a reply is never answered", () => {
  const route: ReplyRoute = { device: "here", session: "dur-caller", delivery: "d-1", root: "d-1", hop: 1 }
  const token = (): string => {
    const value = replyRouteToken(route)
    if (value === undefined) throw new Error("route token did not fit")
    return value
  }
  const router = () => {
    const delivered: { route: ReplyRoute; answer: string | undefined; session: string }[] = []
    return { delivered, routes: createReplyRouter((r, answer, sessionId) => delivered.push({ route: r, answer, session: sessionId })) }
  }

  test.each([
    ["typed input", { role: "user", content: "hi" }],
    ["another client id", { role: "user", content: "hi", clientMessageId: "desktop-123" }],
    ["a reply's id", { role: "user", content: "hi", clientMessageId: "omo-reply.v1:d-0" }],
    ["a forged route token", { role: "user", content: "hi", clientMessageId: "omo-peer.v1:bm90LWpzb24" }],
    ["a delivered reply", { role: "custom", content: "From agent b ...", customType: "session_control_delivery" }],
  ])("#given a run whose input is %s #when it settles #then nothing is routed", (_name, input) => {
    const { delivered, routes } = router()
    routes.noteMessage(input)
    routes.noteMessage({ role: "assistant", content: "answer" })
    routes.settled("dur-on-b")
    expect(delivered).toHaveLength(0)
  })

  test("#given a routed delivery was answered #when the same route input is consumed again #then it is not answered twice", () => {
    const { delivered, routes } = router()
    for (let pass = 0; pass < 2; pass++) {
      routes.noteMessage({ role: "user", content: "q", clientMessageId: token() })
      routes.noteMessage({ role: "assistant", content: `answer ${pass}` })
      routes.settled("dur-on-b")
    }
    expect(delivered.map((entry) => entry.answer)).toEqual(["answer 0"])
  })

  test("#given the run answered the sender itself with thread_send #when it settles #then no automatic reply is added", () => {
    const { delivered, routes } = router()
    routes.noteMessage({ role: "user", content: "q", clientMessageId: token() })
    routes.noteSend("dur-caller")
    routes.noteMessage({ role: "assistant", content: "sent it" })
    routes.settled("dur-on-b")
    expect(delivered).toHaveLength(0)
  })

  test("#given a routed input #when the session ends before its run settles #then nothing is routed", () => {
    const { delivered, routes } = router()
    routes.noteMessage({ role: "user", content: "q", clientMessageId: token() })
    routes.close()
    routes.settled("dur-on-b")
    expect(delivered).toHaveLength(0)
  })
})
