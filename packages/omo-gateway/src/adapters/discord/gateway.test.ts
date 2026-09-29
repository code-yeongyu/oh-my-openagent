import { afterEach, describe, expect, test } from "bun:test"
import { AdapterFatal } from "../../adapter/contract"
import { DiscordGatewayError } from "./gateway"
import { FakeDiscordServer } from "./testing/fake-server"
import { FAKE_CHAT } from "./testing/fake-state"
import { adapterFor, ManualClock, startListening, type Listening } from "./testing/harness"

const servers: FakeDiscordServer[] = []
const listeners: Listening[] = []
afterEach(async () => {
  for (const listener of listeners.splice(0)) await listener.stop()
  for (const server of servers.splice(0)) server.stop()
})

function setup(overrides: Parameters<typeof adapterFor>[1] = {}) {
  const server = new FakeDiscordServer()
  servers.push(server)
  const logs: string[] = []
  const listening = startListening(adapterFor(server, overrides, logs))
  listeners.push(listening)
  return { server, listening, logs }
}

const opCount = (server: FakeDiscordServer, op: number) => server.gateway.ops.filter((entry) => entry.op === op).length
const textCount = (listening: Listening, text: string) => listening.events.filter((event) => event.text === text).length

describe("discord gateway session", () => {
  test("identifies with the bot token and the guild, message, DM, reaction and message-content intents", async () => {
    const { server, listening } = setup()
    await listening.ready
    const intents = server.gateway.ops.find((entry) => entry.op === 2)?.intents ?? 0
    for (const [name, bit] of [
      ["GUILDS", 0],
      ["GUILD_MESSAGES", 9],
      ["GUILD_MESSAGE_REACTIONS", 10],
      ["DIRECT_MESSAGES", 12],
      ["DIRECT_MESSAGE_REACTIONS", 13],
      ["MESSAGE_CONTENT", 15],
    ] as const) {
      expect({ name, set: (intents & (1 << bit)) !== 0 }).toEqual({ name, set: true })
    }
    server.humanPost({ channel_id: FAKE_CHAT, content: "hello" })
    const event = await listening.waitForEvent((e) => e.text === "hello", "the first message")
    expect(event.kind).toBe("channel")
    expect(event.key).toMatchObject({ platform: "discord", chat_id: FAKE_CHAT, thread_id: null })
  })

  test("close 4000 resumes the session: the event posted while down is replayed once, no second identify", async () => {
    const { server, listening } = setup()
    await listening.ready
    server.humanPost({ channel_id: FAKE_CHAT, content: "before-drop" })
    await listening.waitForEvent((e) => e.text === "before-drop", "before-drop")
    server.gateway.closeSockets(4000)
    server.humanPost({ channel_id: FAKE_CHAT, content: "while-down" })
    await server.gateway.waitFor((ops) => ops.some((entry) => entry.op === 6), 5000, "a resume")
    await listening.waitForEvent((e) => e.text === "while-down", "the replayed while-down message")
    server.humanPost({ channel_id: FAKE_CHAT, content: "after-resume" })
    await listening.waitForEvent((e) => e.text === "after-resume", "after-resume")
    expect(opCount(server, 2)).toBe(1)
    expect(opCount(server, 6)).toBe(1)
    const resume = server.gateway.ops.find((entry) => entry.op === 6)
    expect(resume?.session_id).toBe("fake-session-1")
    for (const text of ["before-drop", "while-down", "after-resume"]) expect(textCount(listening, text)).toBe(1)
  })

  test("op 7 reconnect resumes instead of identifying", async () => {
    const { server, listening } = setup()
    await listening.ready
    server.gateway.requestReconnect()
    await server.gateway.waitFor((ops) => ops.some((entry) => entry.op === 6), 5000, "a resume after op 7")
    expect(opCount(server, 2)).toBe(1)
  })

  test("op 9 invalid session (d=false) re-identifies, not resumes, and emits no duplicate events", async () => {
    const { server, listening } = setup()
    await listening.ready
    for (const text of ["one", "two"]) server.humanPost({ channel_id: FAKE_CHAT, content: text })
    await listening.waitForEvent((e) => e.text === "two", "two")
    server.gateway.invalidateSessions(false)
    server.humanPost({ channel_id: FAKE_CHAT, content: "during-gap" })
    await server.gateway.waitFor((ops) => ops.filter((entry) => entry.op === 2).length === 2, 3000, "a second identify after op 9")
    await listening.waitForEvent((e) => e.text === "during-gap", "during-gap, recovered from history after the re-identify")
    server.humanPost({ channel_id: FAKE_CHAT, content: "three" })
    await listening.waitForEvent((e) => e.text === "three", "three on the new session")
    expect(opCount(server, 6)).toBe(0)
    const ids = listening.events.map((event) => event.event_id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const text of ["one", "two", "during-gap", "three"]) expect(textCount(listening, text)).toBe(1)
  })

  test("op 9 with d=true resumes the same session", async () => {
    const { server, listening } = setup()
    await listening.ready
    server.gateway.invalidateSessions(true)
    await server.gateway.waitFor((ops) => ops.some((entry) => entry.op === 6), 5000, "a resume after resumable op 9")
    expect(opCount(server, 2)).toBe(1)
  })

  test("after a re-identify, the next drop resumes the new session", async () => {
    const { server, listening } = setup()
    await listening.ready
    server.gateway.invalidateSessions(false)
    await server.gateway.waitFor((ops) => ops.filter((entry) => entry.op === 2).length === 2, 3000, "re-identify")
    server.gateway.closeSockets(4000)
    await server.gateway.waitFor((ops) => ops.some((entry) => entry.op === 6 && entry.session_id === "fake-session-2"), 3000, "resume of session 2")
    expect(opCount(server, 2)).toBe(2)
  })

  test("a resume the server refuses (op 9 d=false) falls back to identify", async () => {
    const { server, listening } = setup()
    await listening.ready
    server.gateway.forgetSessions()
    server.gateway.closeSockets(4000)
    await server.gateway.waitFor((ops) => ops.filter((entry) => entry.op === 2).length === 2, 3000, "identify after a refused resume")
    expect(opCount(server, 6)).toBe(1)
  })

  test("close 4004 (bad token) is fatal: listen rejects and never reconnects", async () => {
    const server = new FakeDiscordServer()
    servers.push(server)
    const listening = startListening(adapterFor(server, { token: "wrong-token" }))
    const outcome = await listening.done
    expect(outcome).toBeInstanceOf(DiscordGatewayError)
    expect(outcome instanceof DiscordGatewayError ? outcome.code : 0).toBe(4004)
    expect(outcome).toBeInstanceOf(AdapterFatal)
    expect(outcome instanceof AdapterFatal ? [outcome.platform, outcome.reason] : null).toEqual(["discord", "close 4004"])
    expect(opCount(server, 2)).toBe(1)
  })

  test("malformed frames and payloads are dropped; the next valid message still arrives", async () => {
    const { server, listening, logs } = setup()
    await listening.ready
    server.gateway.sendRaw("{not json")
    server.gateway.sendRaw(JSON.stringify({ op: 0, s: 90, t: "MESSAGE_CREATE", d: { id: "1", channel_id: FAKE_CHAT } }))
    server.humanPost({ channel_id: FAKE_CHAT, content: "still-alive" })
    await listening.waitForEvent((e) => e.text === "still-alive", "a valid message after garbage")
    expect(logs.some((line) => line.includes("non-JSON"))).toBe(true)
    expect(logs.some((line) => line.includes("malformed MESSAGE_CREATE"))).toBe(true)
  })

  test("heartbeat: beats carry the last seq, and a missed ACK closes 4000 and resumes", async () => {
    const clock = new ManualClock()
    const { server, listening } = setup({ clock })
    await listening.ready
    clock.advance(0)
    await server.gateway.waitFor((ops) => ops.some((entry) => entry.op === 1), 3000, "the first heartbeat")
    server.humanPost({ channel_id: FAKE_CHAT, content: "barrier" })
    await listening.waitForEvent((e) => e.text === "barrier", "a dispatch after the ACK")
    server.gateway.ackHeartbeats = false
    clock.advance(server.gateway.heartbeatInterval)
    await server.gateway.waitFor((ops) => ops.filter((entry) => entry.op === 1).length === 2, 3000, "the second heartbeat")
    expect(opCount(server, 6)).toBe(0)
    expect(server.gateway.ops.filter((entry) => entry.op === 1).at(-1)?.seq).toBeGreaterThan(0)
    clock.advance(server.gateway.heartbeatInterval)
    await server.gateway.waitFor((ops) => ops.some((entry) => entry.op === 6), 3000, "a resume after the missed ACK")
    expect(opCount(server, 2)).toBe(1)
  })

  test("abort resolves listen and closes the socket", async () => {
    const { server, listening } = setup()
    await listening.ready
    expect(await listening.stop()).toBeNull()
    await server.gateway.waitFor(() => server.gateway.openSockets === 0, 3000, "the socket to close")
  })
})
