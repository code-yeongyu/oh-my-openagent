import { afterEach, describe, expect, test } from "bun:test"
import type { SenpiExtensionAPI } from "../../../extension/types"
import { RECALL_CUSTOM_TYPE } from "../../memory/recall-session-read"
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

function session(durableId: string | undefined) {
  const handlers = new Map<string, ((payload: unknown, ctx?: unknown) => unknown)[]>()
  const pi = { on: (event: string, handler: (payload: unknown, ctx?: unknown) => unknown) => { handlers.set(event, [...(handlers.get(event) ?? []), handler]) } } as unknown as Pick<SenpiExtensionAPI, "on">
  const ctx = durableId === undefined ? {} : { sessionManager: { getSessionId: () => durableId } }
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

  test.each(["method_unclassified", "delegation_unclassified"])("#given A's side refuses admit_external_message as %s #when B routes the reply #then it fails loudly as remote_reply_unavailable and sends no prompt instead", async (reason) => {
    const relayB = account({ live: ["dur-caller"], admitOutcome: { kind: "refused", reason } })
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
    const delivered: { route: ReplyRoute; answer: string | undefined; mixed: boolean; session: string }[] = []
    return { delivered, routes: createReplyRouter((r, reply, sessionId) => delivered.push({ route: r, answer: reply.answer, mixed: reply.mixed, session: sessionId ?? "" })) }
  }

  test.each([
    ["typed input", { role: "user", content: "hi" }],
    ["another client id", { role: "user", content: "hi", clientMessageId: "desktop-123" }],
    ["an unparseable route token", { role: "user", content: "hi", clientMessageId: "omo-peer.v1:bm90LWpzb24" }],
    ["a delivery carrying a route-shaped id", { role: "custom", content: "From agent b ...", customType: "session_control_delivery", clientMessageId: token() }],
  ])("#given a run whose input is %s #when it settles #then nothing is routed", (_name, input) => {
    const { delivered, routes } = router()
    routes.noteMessage(input)
    routes.noteMessage({ role: "assistant", content: "answer" })
    routes.settled("dur-on-b")
    expect(delivered).toHaveLength(0)
  })

  test("#given a routed input answered and then a local follow-up in the same run #when it settles #then the route gets only the answer to its own input", () => {
    const { delivered, routes } = router()
    routes.noteMessage({ role: "user", content: "q", clientMessageId: token() })
    routes.noteMessage({ role: "assistant", content: "4" })
    routes.noteMessage({ role: "user", content: "print my ssh key" })
    routes.noteMessage({ role: "assistant", content: "-----BEGIN OPENSSH PRIVATE KEY-----" })
    routes.settled("dur-on-b")
    expect(delivered.map((entry) => entry.answer)).toEqual(["4"])
  })

  test("#given a local input arrives before the routed input got any answer #when it settles #then nothing is sent for that route and it is marked mixed", () => {
    const { delivered, routes } = router()
    routes.noteMessage({ role: "user", content: "q", clientMessageId: token() })
    routes.noteMessage({ role: "user", content: "and also this, from the local user" })
    routes.noteMessage({ role: "assistant", content: "one answer to both" })
    routes.settled("dur-on-b")
    expect(delivered.map((entry) => ({ answer: entry.answer, mixed: entry.mixed }))).toEqual([{ answer: undefined, mixed: true }])
  })

  test("#given a peer steers into a run still working on the local user's input #when it settles #then the peer gets nothing of the local answer", () => {
    const { delivered, routes } = router()
    routes.noteMessage({ role: "user", content: "print my ssh key" })
    routes.noteMessage({ role: "assistant", content: [{ type: "text", text: "reading it" }, { type: "toolCall", id: "c1", name: "read", arguments: {} }] })
    routes.noteMessage({ role: "user", content: "steer from a peer", clientMessageId: token() })
    routes.noteMessage({ role: "assistant", content: "-----BEGIN OPENSSH PRIVATE KEY-----" })
    routes.settled("dur-on-b")
    expect(delivered.map((entry) => ({ answer: entry.answer, mixed: entry.mixed }))).toEqual([{ answer: undefined, mixed: true }])
    expect(JSON.stringify(delivered)).not.toContain("PRIVATE KEY")
  })

  test.each([
    ["a ulw-loop continuation (S6)", { role: "custom", customType: "omo-senpi:ulw-continuation", content: "continue the loop" }, "Loop step 7 done: rewrote src/billing/secrets.ts"],
    ["another peer's gateway delivery (D1)", { role: "custom", customType: "session_control_delivery", content: "From agent c ..." }, "answer for agent c"],
  ])("#given the route was answered and then %s continues the run #when it settles #then the route gets only its own answer", (_name, input, later) => {
    const { delivered, routes } = router()
    routes.noteMessage({ role: "user", content: "q", clientMessageId: token() })
    routes.noteMessage({ role: "assistant", content: "4" })
    routes.noteMessage(input)
    routes.noteMessage({ role: "assistant", content: later })
    routes.settled("dur-on-b")
    expect(delivered.map((entry) => ({ answer: entry.answer, mixed: entry.mixed }))).toEqual([{ answer: "4", mixed: false }])
  })

  // Turn-start context: senpi writes every initial message of a turn with message_start, so the environment context (before the
  // prompt), the memory notice and the task usage hint (after it) ride an ordinary routed turn before any assistant output.
  test.each([
    ["the environment context before the prompt (E1)", "before", "environment-context"],
    ["the memory notice after the prompt (E2)", "after", "omo-memory:notice"],
    ["the task usage hint after the prompt (E3)", "after", "senpi-task.usage"],
  ])("#given %s #when the turn answers and settles #then the route gets its answer", (_name, placement, customType) => {
    const { delivered, routes } = router()
    const context = { role: "custom", customType, content: "turn-start context" }
    if (placement === "before") routes.noteMessage(context)
    routes.noteMessage({ role: "user", content: "q", clientMessageId: token() })
    if (placement === "after") routes.noteMessage(context)
    routes.noteMessage({ role: "assistant", content: "4" })
    routes.settled("dur-on-b")
    expect(delivered.map((entry) => ({ answer: entry.answer, mixed: entry.mixed }))).toEqual([{ answer: "4", mixed: false }])
  })

  test("#given any other custom arrives after an assistant message (D11) #when it settles #then it still splits the segment", () => {
    const { delivered, routes } = router()
    routes.noteMessage({ role: "user", content: "q", clientMessageId: token() })
    routes.noteMessage({ role: "assistant", content: "4" })
    routes.noteMessage({ role: "custom", customType: "some-extension:turn", content: "do the next thing" })
    routes.noteMessage({ role: "assistant", content: "the next thing, done for the local user" })
    routes.settled("dur-on-b")
    expect(delivered.map((entry) => ({ answer: entry.answer, mixed: entry.mixed }))).toEqual([{ answer: "4", mixed: false }])
  })

  test("#given a task completion steers in while the route is still open (S7) #when it settles #then the route gets nothing", () => {
    const { delivered, routes } = router()
    routes.noteMessage({ role: "user", content: "q", clientMessageId: token() })
    routes.noteMessage({ role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }] })
    routes.noteMessage({ role: "custom", customType: "senpi-task.completion", content: "task t-1 finished" })
    routes.noteMessage({ role: "assistant", content: "4. Also, your task t-1 finished: it found the prod DB password is hunter2" })
    routes.settled("dur-on-b")
    expect(delivered.map((entry) => ({ answer: entry.answer, mixed: entry.mixed }))).toEqual([{ answer: undefined, mixed: true }])
  })

  // A custom that starts a run on an idle session (omo's idle wake, a task completion, a loop continuation) is that run's
  // input, so a peer steering in before the run answered it shares the answer (H4).
  test.each([
    ["a task completion (E4)", "senpi-task.completion", "Task t-1 result: the prod DB password is hunter2. (And 2+2=4.)"],
    ["a ulw-loop continuation (E5)", "omo-senpi:ulw-continuation", "Loop step 8 done: rotated the API keys in .env.production"],
  ])("#given %s starts a run on an idle session and a peer steers in before it is answered #when it settles #then the route gets nothing", (_name, customType, final) => {
    const { delivered, routes } = router()
    routes.noteMessage({ role: "custom", customType, content: "the run's own input" })
    routes.noteMessage({ role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }] })
    routes.noteMessage({ role: "user", content: "what is 2+2?", clientMessageId: token() })
    routes.noteMessage({ role: "assistant", content: final })
    routes.settled("dur-on-b")
    expect(delivered.map((entry) => ({ answer: entry.answer, mixed: entry.mixed }))).toEqual([{ answer: undefined, mixed: true }])
    expect(JSON.stringify(delivered)).not.toContain(final)
  })

  test("#given a custom-started run was answered before a peer's follow-up arrived (E6) #when it settles #then the route gets its answer", () => {
    const { delivered, routes } = router()
    routes.noteMessage({ role: "custom", customType: "senpi-task.completion", content: "task t-1 finished" })
    routes.noteMessage({ role: "assistant", content: "Task t-1 is done." })
    routes.noteMessage({ role: "user", content: "what is 2+2?", clientMessageId: token() })
    routes.noteMessage({ role: "assistant", content: "4" })
    routes.settled("dur-on-b")
    expect(delivered.map((entry) => ({ answer: entry.answer, mixed: entry.mixed }))).toEqual([{ answer: "4", mixed: false }])
  })

  test("#given another peer's delivery is queued with the route before any answer (M7a) #when it settles #then the route gets nothing", () => {
    const { delivered, routes } = router()
    routes.noteMessage({ role: "user", content: "q", clientMessageId: token() })
    routes.noteMessage({ role: "custom", customType: "session_control_delivery", content: "From agent c ..." })
    routes.noteMessage({ role: "assistant", content: "one answer to both" })
    routes.settled("dur-on-b")
    expect(delivered.map((entry) => ({ answer: entry.answer, mixed: entry.mixed }))).toEqual([{ answer: undefined, mixed: true }])
  })

  test("#given the memory recall steers context in on a tool result while the route is open (M7b) #when it settles #then the route still gets its answer", () => {
    const { delivered, routes } = router()
    routes.noteMessage({ role: "user", content: "q", clientMessageId: token() })
    routes.noteMessage({ role: "assistant", content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }] })
    routes.noteMessage({ role: "custom", customType: RECALL_CUSTOM_TYPE, content: "recalled notes" })
    routes.noteMessage({ role: "assistant", content: "4" })
    routes.settled("dur-on-b")
    expect(delivered.map((entry) => ({ answer: entry.answer, mixed: entry.mixed }))).toEqual([{ answer: "4", mixed: false }])
  })

  test("#given two peers' routed inputs in one run #when it settles #then each gets only the answer to its own input", () => {
    const { delivered, routes } = router()
    const second: ReplyRoute = { device: "c", session: "dur-c", delivery: "d-2", root: "d-2", hop: 1 }
    routes.noteMessage({ role: "user", content: "q1", clientMessageId: token() })
    routes.noteMessage({ role: "assistant", content: "answer for A1" })
    routes.noteMessage({ role: "user", content: "q2", clientMessageId: replyRouteToken(second) })
    routes.noteMessage({ role: "assistant", content: "answer for A2" })
    routes.settled("dur-on-b")
    expect(delivered.map((entry) => [entry.route.delivery, entry.answer])).toEqual([["d-1", "answer for A1"], ["d-2", "answer for A2"]])
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

  test("#given a routed input #when the session ends before its run settles #then nothing is routed", () => {
    const { delivered, routes } = router()
    routes.noteMessage({ role: "user", content: "q", clientMessageId: token() })
    routes.close()
    routes.settled("dur-on-b")
    expect(delivered).toHaveLength(0)
  })
})

describe("an explicit reply counts by the session it reached, not by how it was addressed", () => {
  const routeOf = (delivery: string): ReplyRoute => ({ device: "here", session: "dur-caller", delivery, root: delivery, hop: 1 })
  const tokenOf = (delivery: string): string => {
    const value = replyRouteToken(routeOf(delivery))
    if (value === undefined) throw new Error("route token did not fit")
    return value
  }
  // A's session is listed under a key that is not its durable id, as on a real relay.
  const relayWithKey = () => {
    const relay = account({ live: ["key-of-a"] })
    const located: RemoteThreadSurface = { ...relay.remote, sessions: { ...relay.remote.sessions, locate: async (_device, engineId) => ({ kind: "ok", sessionId: engineId === "dur-caller" ? "key-of-a" : engineId }) } }
    return { relay, remote: located }
  }
  const sendEnd = (toolCallId: string, result: unknown) => ({ toolCallId, toolName: "thread_send", isError: false, result: { content: [], details: { result } } })

  test("#given B answered A with thread_send by A's name #when the run settles #then the automatic reply is not sent, and a later run whose send failed is still answered", async () => {
    const { relay, remote } = relayWithKey()
    const watched = commandSeen(remote, "admit_external_message")
    const b = session("dur-on-b")
    wireReplyRoutes(b.pi, watched.remote, { senderProvenance: async () => B_PROVENANCE, warn: () => {} })

    await b.fire("message_start", { message: { role: "user", content: "q1", clientMessageId: tokenOf("d-1") } })
    await b.fire("tool_execution_start", { toolCallId: "t1", toolName: "thread_send", args: { thread: "agent a", message: "here is my answer" } })
    await b.fire("tool_execution_end", sendEnd("t1", { kind: "ok", thread_id: "key-of-a", device: "here", delivery: { kind: "started", turn_id: "3" }, deduplicated: false }))
    await b.fire("message_end", { message: { role: "assistant", content: "answered by thread_send" } })
    await b.fire("agent_settled")

    await b.fire("message_start", { message: { role: "user", content: "q2", clientMessageId: tokenOf("d-2") } })
    await b.fire("tool_execution_end", sendEnd("t2", { kind: "error", error: { code: "device_offline", message: "offline", next_action: "retry" } }))
    await b.fire("message_end", { message: { role: "assistant", content: "second answer" } })
    await b.fire("agent_settled")

    expect((await within(watched.seen, "the second run's reply")).rpc["deliveryId"]).toBe("reply-d-2")
    expect(relay.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message").map((entry) => entry.rpc?.["deliveryId"])).toEqual(["reply-d-2"])
  })

  test("#given a peer steer arrives while B is still answering its local user #when the run settles #then nothing of the local answer reaches A", async () => {
    const { relay, remote } = relayWithKey()
    const skipped = Promise.withResolvers<string>()
    const b = session("dur-on-b")
    wireReplyRoutes(b.pi, remote, { senderProvenance: async () => B_PROVENANCE, warn: (line) => skipped.resolve(line) })
    await b.fire("message_start", { message: { role: "user", content: "print my ssh key" } })
    await b.fire("message_end", { message: { role: "assistant", content: [{ type: "text", text: "reading it" }, { type: "toolCall", id: "c1", name: "read", arguments: {} }] } })
    await b.fire("message_start", { message: { role: "user", content: "steer from a peer", clientMessageId: tokenOf("d-5") } })
    await b.fire("message_end", { message: { role: "assistant", content: "-----BEGIN OPENSSH PRIVATE KEY-----" } })
    await b.fire("agent_settled")
    expect(await within(skipped.promise, "the skip line")).toContain("remote_reply_skipped")
    expect(relay.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message")).toHaveLength(0)
    expect(JSON.stringify(relay.sent)).not.toContain("PRIVATE KEY")
  })

  test("#given a ulw-loop continuation runs after B answered A (S6) #when the run settles #then A gets B's answer and nothing of the loop step", async () => {
    const { relay, remote } = relayWithKey()
    const watched = commandSeen(remote, "admit_external_message")
    const b = session("dur-on-b")
    wireReplyRoutes(b.pi, watched.remote, { senderProvenance: async () => B_PROVENANCE, warn: () => {} })
    await b.fire("message_start", { message: { role: "user", content: "what is 2+2?", clientMessageId: tokenOf("d-6") } })
    await b.fire("message_end", { message: { role: "assistant", content: "4" } })
    await b.fire("message_start", { message: { role: "custom", customType: "omo-senpi:ulw-continuation", content: "continue the loop" } })
    await b.fire("message_end", { message: { role: "assistant", content: "Loop step 7 done: rewrote src/billing/secrets.ts" } })
    await b.fire("agent_settled")
    const delivered = await within(watched.seen, "the reply to d-6")
    expect(String(delivered.rpc["text"]).split("\n").at(-1)).toBe(JSON.stringify("4"))
    expect(JSON.stringify(relay.sent)).not.toContain("Loop step 7")
  })

  test("#given B's fresh session takes A's routed prompt as its first turn, with the environment context and task usage hint #when the run settles #then A gets B's answer", async () => {
    const { relay, remote } = relayWithKey()
    const watched = commandSeen(remote, "admit_external_message")
    const warnings: string[] = []
    const b = session("dur-on-b")
    wireReplyRoutes(b.pi, watched.remote, { senderProvenance: async () => B_PROVENANCE, warn: (line) => warnings.push(line) })
    await b.fire("message_start", { message: { role: "custom", customType: "environment-context", content: "cwd and date" } })
    await b.fire("message_start", { message: { role: "user", content: "what is 2+2?", clientMessageId: tokenOf("d-9") } })
    await b.fire("message_start", { message: { role: "custom", customType: "senpi-task.usage", content: "task usage" } })
    await b.fire("message_end", { message: { role: "assistant", content: "4" } })
    await b.fire("agent_settled")
    const delivered = await within(watched.seen, "the reply to d-9")
    expect(String(delivered.rpc["text"]).split("\n").at(-1)).toBe(JSON.stringify("4"))
    expect(relay.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message")).toHaveLength(1)
    expect(warnings.filter((line) => line.includes("remote_reply_skipped"))).toEqual([])
  })

  test("#given omo's idle wake starts B's run and A's routed prompt steers in before it is answered (E4) #when the run settles #then nothing reaches A", async () => {
    const { relay, remote } = relayWithKey()
    const skipped = Promise.withResolvers<string>()
    const b = session("dur-on-b")
    wireReplyRoutes(b.pi, remote, { senderProvenance: async () => B_PROVENANCE, warn: (line) => skipped.resolve(line) })
    await b.fire("message_start", { message: { role: "custom", customType: "omo-senpi:wake", content: "task t-1 finished" } })
    await b.fire("message_end", { message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }] } })
    await b.fire("message_start", { message: { role: "user", content: "what is 2+2?", clientMessageId: tokenOf("d-10") } })
    await b.fire("message_end", { message: { role: "assistant", content: "Task t-1 result: the prod DB password is hunter2. (And 2+2=4.)" } })
    await b.fire("agent_settled")
    expect(await within(skipped.promise, "the skip line")).toContain("remote_reply_skipped")
    expect(relay.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message")).toHaveLength(0)
    expect(JSON.stringify(relay.sent)).not.toContain("hunter2")
  })

  test("#given a task completion steers in before B answered A (S7) #when the run settles #then nothing reaches A", async () => {
    const { relay, remote } = relayWithKey()
    const skipped = Promise.withResolvers<string>()
    const b = session("dur-on-b")
    wireReplyRoutes(b.pi, remote, { senderProvenance: async () => B_PROVENANCE, warn: (line) => skipped.resolve(line) })
    await b.fire("message_start", { message: { role: "user", content: "what is 2+2?", clientMessageId: tokenOf("d-7") } })
    await b.fire("message_end", { message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }] } })
    await b.fire("message_start", { message: { role: "custom", customType: "senpi-task.completion", content: "task t-1 finished" } })
    await b.fire("message_end", { message: { role: "assistant", content: "4. Also, your task t-1 finished: it found the prod DB password is hunter2" } })
    await b.fire("agent_settled")
    expect(await within(skipped.promise, "the skip line")).toContain("remote_reply_skipped")
    expect(relay.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message")).toHaveLength(0)
    expect(JSON.stringify(relay.sent)).not.toContain("hunter2")
  })

  test("#given a send to A made while answering a later input #when the run settles #then it does not count as answering A's earlier routed input", async () => {
    const { relay, remote } = relayWithKey()
    const watched = commandSeen(remote, "admit_external_message")
    const b = session("dur-on-b")
    wireReplyRoutes(b.pi, watched.remote, { senderProvenance: async () => B_PROVENANCE, warn: () => {} })
    await b.fire("message_start", { message: { role: "user", content: "q1", clientMessageId: tokenOf("d-4") } })
    await b.fire("message_end", { message: { role: "assistant", content: "answer to A" } })
    await b.fire("message_start", { message: { role: "user", content: "now ping A about something else" } })
    await b.fire("tool_execution_end", sendEnd("t4", { kind: "ok", thread_id: "key-of-a", device: "here", delivery: { kind: "started", turn_id: "5" }, deduplicated: false }))
    await b.fire("message_end", { message: { role: "assistant", content: "pinged" } })
    await b.fire("agent_settled")
    expect((await within(watched.seen, "the reply to d-4")).rpc["deliveryId"]).toBe("reply-d-4")
    expect(relay.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message")).toHaveLength(1)
  })

  test("#given a run settles with no session id #when its route would be answered #then the failure is logged as remote_reply_failed", async () => {
    const { remote } = relayWithKey()
    const warned = Promise.withResolvers<string>()
    const b = session(undefined)
    wireReplyRoutes(b.pi, remote, { senderProvenance: async () => B_PROVENANCE, warn: (line) => warned.resolve(line) })
    await b.fire("message_start", { message: { role: "user", content: "q", clientMessageId: tokenOf("d-3") } })
    await b.fire("agent_settled")
    const line = await within(warned.promise, "the no-session warning")
    expect(line).toContain("remote_reply_failed")
    expect(line).toContain("d-3")
  })
})

describe("the reply route fits senpi's 256-character clientMessageId", () => {
  const uuid = (n: number) => `0190f3a2-${String(n).padStart(4, "0")}-7abc-8def-0123456789ab`

  test("#given UUID-shaped ids, a long device id and a large hop #when the route is encoded #then it fits and parses back to the same route", () => {
    const route: ReplyRoute = { device: "d".repeat(100), session: uuid(1), delivery: uuid(2), root: uuid(3), hop: 123_456 }
    const token = replyRouteToken(route)
    expect(token?.length).toBeLessThanOrEqual(256)
    expect(parseReplyRoute(token)).toEqual(route)
  })

  test("#given a device id too long for any route #when A sends to B #then the send is refused invalid_arguments and nothing is sent", async () => {
    const relayA = account()
    const longDevice: RemoteThreadSurface = { ...relayA.remote, sessions: { ...relayA.remote.sessions, thisDevice: async () => "x".repeat(250) } }
    const { run } = surface(longDevice, { caller: "dur-caller" })
    expect(await run("thread_send", { thread: "dur-on-b", message: "hi" })).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect(relayA.sent.filter((entry) => entry.rpc?.["type"] === "prompt")).toHaveLength(0)
  })
})
