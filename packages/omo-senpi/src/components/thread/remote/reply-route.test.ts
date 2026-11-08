import { afterEach, describe, expect, test } from "bun:test"
import type { SenpiExtensionAPI } from "../../../extension/types"
import { RECALL_CUSTOM_TYPE } from "../../memory/recall-session-read"
import type { Provenance } from "../gateway/types"
import { createRemoteThreadFixture } from "../thread-remote-fixture"
import { wireReplyRoutes } from "./lazy-ops"
import type { JsonObject, RemoteThreadSurface } from "./ports"
import { OTHER_INPUT_LABEL } from "./reply-admit"
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

describe("every routed input the run consumed gets the run's final answer, labelled when another input shared the run", () => {
  const route: ReplyRoute = { device: "here", session: "dur-caller", delivery: "d-1", root: "d-1", hop: 1 }
  const token = (): string => {
    const value = replyRouteToken(route)
    if (value === undefined) throw new Error("route token did not fit")
    return value
  }
  const router = () => {
    const delivered: { route: ReplyRoute; answer: string | undefined; otherInput: boolean; session: string }[] = []
    return { delivered, routes: createReplyRouter((r, reply, sessionId) => delivered.push({ route: r, answer: reply.answer, otherInput: reply.otherInput, session: sessionId ?? "" })) }
  }
  const replies = (delivered: { answer: string | undefined; otherInput: boolean }[]) => delivered.map((entry) => ({ answer: entry.answer, otherInput: entry.otherInput }))

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

  test("#given a routed input alone in its run #when it settles #then the route gets the final answer with no label", () => {
    const { delivered, routes } = router()
    routes.noteMessage({ role: "user", content: "q", clientMessageId: token() })
    routes.noteMessage({ role: "assistant", content: [{ type: "text", text: "checking" }, { type: "toolCall", id: "c1", name: "read", arguments: {} }] })
    routes.noteMessage({ role: "assistant", content: "4" })
    routes.settled("dur-on-b")
    expect(replies(delivered)).toEqual([{ answer: "4", otherInput: false }])
    expect(delivered[0]?.session).toBe("dur-on-b")
  })

  test("#given a run that ends on a tool call #when it settles #then the route still gets the run's last text", () => {
    const { delivered, routes } = router()
    routes.noteMessage({ role: "user", content: "q", clientMessageId: token() })
    routes.noteMessage({ role: "assistant", content: [{ type: "text", text: "partial work" }, { type: "toolCall", id: "c1", name: "bash", arguments: {} }] })
    routes.settled("dur-on-b")
    expect(replies(delivered)).toEqual([{ answer: "partial work", otherInput: false }])
  })

  test.each([
    ["a local user message after the route", [{ role: "user", content: "q", clientMessageId: "ROUTE" }, { role: "assistant", content: "4" }, { role: "user", content: "and now this" }, { role: "assistant", content: "done for the local user" }], "done for the local user"],
    ["a peer steer into a run answering the local user", [{ role: "user", content: "print my notes" }, { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }] }, { role: "user", content: "steer", clientMessageId: "ROUTE" }, { role: "assistant", content: "the notes, and 4" }], "the notes, and 4"],
    ["another party's delivery in the run", [{ role: "user", content: "q", clientMessageId: "ROUTE" }, { role: "custom", customType: "session_control_delivery", content: "From agent c ..." }, { role: "assistant", content: "one answer to both" }], "one answer to both"],
  ])("#given %s #when it settles #then the route gets the run's final answer, labelled as possibly covering other input", (_name, messages, final) => {
    const { delivered, routes } = router()
    for (const message of messages) routes.noteMessage(message.clientMessageId === "ROUTE" ? { ...message, clientMessageId: token() } : message)
    routes.settled("dur-on-b")
    expect(replies(delivered)).toEqual([{ answer: final, otherInput: true }])
  })

  // Engine and extension customs are never other input: turn-start context, the memory recall, continuations and task
  // completions ride or drive the run, but no other party asked anything in it.
  test.each([
    ["the environment context before the prompt", "before", "environment-context"],
    ["the memory notice after the prompt", "after", "omo-memory:notice"],
    ["the task usage hint after the prompt", "after", "senpi-task.usage"],
    ["the memory recall after a tool call", "mid", RECALL_CUSTOM_TYPE],
    ["a task completion mid-turn", "mid", "senpi-task.completion"],
    ["a ulw-loop continuation after the answer", "late", "omo-senpi:ulw-continuation"],
    ["omo's idle wake that started the run", "before", "omo-senpi:wake"],
  ])("#given %s #when the run settles #then the route gets the final answer with no label", (_name, placement, customType) => {
    const { delivered, routes } = router()
    const custom = { role: "custom", customType, content: "engine or extension custom" }
    if (placement === "before") routes.noteMessage(custom)
    routes.noteMessage({ role: "user", content: "q", clientMessageId: token() })
    if (placement === "after") routes.noteMessage(custom)
    routes.noteMessage({ role: "assistant", content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }] })
    if (placement === "mid") routes.noteMessage(custom)
    routes.noteMessage({ role: "assistant", content: "4" })
    if (placement === "late") {
      routes.noteMessage(custom)
      routes.noteMessage({ role: "assistant", content: "loop step done" })
    }
    routes.settled("dur-on-b")
    expect(replies(delivered)).toEqual([{ answer: placement === "late" ? "loop step done" : "4", otherInput: false }])
  })

  test("#given two peers' routed inputs in one run #when it settles #then both get the run's final answer, labelled", () => {
    const { delivered, routes } = router()
    const second: ReplyRoute = { device: "c", session: "dur-c", delivery: "d-2", root: "d-2", hop: 1 }
    routes.noteMessage({ role: "user", content: "q1", clientMessageId: token() })
    routes.noteMessage({ role: "user", content: "q2", clientMessageId: replyRouteToken(second) })
    routes.noteMessage({ role: "assistant", content: "both answered" })
    routes.settled("dur-on-b")
    expect(delivered.map((entry) => [entry.route.delivery, entry.answer, entry.otherInput])).toEqual([["d-1", "both answered", true], ["d-2", "both answered", true]])
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

describe("the reply reaches A's session whatever else the run did", () => {
  const routeOf = (delivery: string): ReplyRoute => ({ device: "here", session: "dur-caller", delivery, root: delivery, hop: 1 })
  const tokenOf = (delivery: string): string => {
    const value = replyRouteToken(routeOf(delivery))
    if (value === undefined) throw new Error("route token did not fit")
    return value
  }
  // A's session is listed under a key that is not its durable id, as on a real relay.
  const relayWithKey = (options: Parameters<typeof account>[0] = {}) => {
    const relay = account({ live: ["key-of-a"], ...options })
    const located: RemoteThreadSurface = { ...relay.remote, sessions: { ...relay.remote.sessions, locate: async (_device, engineId) => ({ kind: "ok", sessionId: engineId === "dur-caller" ? "key-of-a" : engineId }) } }
    return { relay, remote: located }
  }
  const sendEnd = (toolCallId: string, result: unknown) => ({ toolCallId, toolName: "thread_send", isError: false, result: { content: [], details: { result } } })
  const admits = (relay: ReturnType<typeof account>) => relay.sent.filter((entry) => entry.rpc?.["type"] === "admit_external_message")
  const bodyOf = (rpc: JsonObject): string => String(rpc["displayText"])

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
    expect(admits(relay).map((entry) => entry.rpc?.["deliveryId"])).toEqual(["reply-d-2"])
  })

  test.each([
    ["a peer steer into a run answering B's local user", [["message_start", { role: "user", content: "print my notes" }], ["message_end", { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }] }], ["message_start", { role: "user", content: "what is 2+2?", clientMessageId: "ROUTE" }], ["message_end", { role: "assistant", content: "your notes, and 4" }]], "your notes, and 4", true],
    ["a task completion mid-turn (S7 shape)", [["message_start", { role: "user", content: "what is 2+2?", clientMessageId: "ROUTE" }], ["message_end", { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }] }], ["message_start", { role: "custom", customType: "senpi-task.completion", content: "task t-1 finished" }], ["message_end", { role: "assistant", content: "4, and task t-1 finished" }]], "4, and task t-1 finished", false],
    ["omo's idle wake starting the run (E4 shape)", [["message_start", { role: "custom", customType: "omo-senpi:wake", content: "task t-1 finished" }], ["message_end", { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "read", arguments: {} }] }], ["message_start", { role: "user", content: "what is 2+2?", clientMessageId: "ROUTE" }], ["message_end", { role: "assistant", content: "4" }]], "4", false],
    ["a fresh session's environment context and task usage hint", [["message_start", { role: "custom", customType: "environment-context", content: "cwd and date" }], ["message_start", { role: "user", content: "what is 2+2?", clientMessageId: "ROUTE" }], ["message_start", { role: "custom", customType: "senpi-task.usage", content: "task usage" }], ["message_end", { role: "assistant", content: "4" }]], "4", false],
  ])("#given %s #when the run settles #then A gets exactly one admitted delivery carrying B's final answer", async (_name, events, final, labelled) => {
    const { relay, remote } = relayWithKey()
    const watched = commandSeen(remote, "admit_external_message")
    const b = session("dur-on-b")
    wireReplyRoutes(b.pi, watched.remote, { senderProvenance: async () => B_PROVENANCE, sessionName: () => "agent b", warn: () => {} })
    for (const [event, message] of events as [string, Record<string, unknown>][]) await b.fire(event, { message: message["clientMessageId"] === "ROUTE" ? { ...message, clientMessageId: tokenOf("d-8") } : message })
    await b.fire("agent_settled")
    const delivered = await within(watched.seen, "the reply to d-8")
    expect(delivered.rpc).toMatchObject({ type: "admit_external_message", sessionId: "key-of-a", deliveryId: "reply-d-8", deliverAs: "followUp", sender: { kind: "agent", session_id: "dur-on-b", name: "agent b" } })
    expect(admits(relay)).toHaveLength(1)
    expect(bodyOf(delivered.rpc).split("\n")).toEqual(["Reply to delivery d-8.", ...(labelled ? [OTHER_INPUT_LABEL] : []), final])
  })

  test("#given A's user is composing a draft #when B's reply is refused held_draft #then B logs remote_reply_held and retries until A admits it", async () => {
    const { relay, remote } = relayWithKey()
    let held = 2
    const watched = commandSeen(remote, "admit_external_message")
    const heldRemote: RemoteThreadSurface = { ...watched.remote, sessions: { ...watched.remote.sessions, sessionCommand: async (device, sessionId, rpc, options) => {
      if (rpc["type"] === "admit_external_message" && held > 0) {
        held -= 1
        return { kind: "refused", reason: "held_draft" }
      }
      return await watched.remote.sessions.sessionCommand(device, sessionId, rpc, options)
    } } }
    const warnings: string[] = []
    const b = session("dur-on-b")
    wireReplyRoutes(b.pi, heldRemote, { senderProvenance: async () => B_PROVENANCE, warn: (line) => warnings.push(line), heldRetryDelaysMs: [0, 0, 0] })
    await b.fire("message_start", { message: { role: "user", content: "q", clientMessageId: tokenOf("d-11") } })
    await b.fire("message_end", { message: { role: "assistant", content: "4" } })
    await b.fire("agent_settled")
    expect((await within(watched.seen, "the retried reply")).rpc["deliveryId"]).toBe("reply-d-11")
    expect(warnings.filter((line) => line.startsWith("remote_reply_held"))).toHaveLength(2)
    expect(admits(relay)).toHaveLength(1)
  })

  test("#given A's user keeps the draft open past every retry #when the last retry is refused #then B reports remote_reply_failed", async () => {
    const { remote } = relayWithKey({ admitOutcome: { kind: "refused", reason: "held_draft" } })
    const failed = Promise.withResolvers<string>()
    const warnings: string[] = []
    const b = session("dur-on-b")
    wireReplyRoutes(b.pi, remote, { senderProvenance: async () => B_PROVENANCE, warn: (line) => (line.startsWith("remote_reply_failed") ? failed.resolve(line) : warnings.push(line)), heldRetryDelaysMs: [0] })
    await b.fire("message_start", { message: { role: "user", content: "q", clientMessageId: tokenOf("d-12") } })
    await b.fire("message_end", { message: { role: "assistant", content: "4" } })
    await b.fire("agent_settled")
    expect(await within(failed.promise, "the give-up line")).toContain("d-12")
    expect(warnings.filter((line) => line.startsWith("remote_reply_held"))).toHaveLength(1)
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
