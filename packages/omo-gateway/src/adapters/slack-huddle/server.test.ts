import { afterEach, expect, test } from "bun:test"
import { syntheticTone } from "./audio"
import type { HuddleControl, HuddleStatus } from "./driver"
import { serveHuddle, type HuddleServer } from "./server"
import type { AudioFrame, CallEvent, CallKey } from "./voice-contract"
import { VoiceRefusal } from "./voice-contract"
import { decodeAudioFrame, encodeAudioFrame } from "./wire"

const TOKEN = "0123456789abcdef"
const CALL: CallKey = { platform: "slack", account_id: "T_TEST", chat_id: "C_TEST", call_id: "1759000000.000100" }

function fakeDriver() {
  const audio = new Set<(frame: AudioFrame) => void>()
  const events = new Set<(event: CallEvent) => void>()
  const spoken: { pcm: Int16Array; rate: number }[] = []
  let onDrained: (() => void) | null = null
  const drainedIfEmpty = (): void => {
    if (audio.size === 0 && events.size === 0) onDrained?.()
  }
  const joined: string[] = []
  let refuseJoin = false
  let status: HuddleStatus = { state: "idle", chat_id: null, call_id: null, since: null, capturing: false, participants: [], thread_id: null }
  const control: HuddleControl = {
    status: () => status,
    onAudio(sink) {
      audio.add(sink)
      return () => {
        audio.delete(sink)
        drainedIfEmpty()
      }
    },
    onEvent(sink) {
      events.add(sink)
      return () => {
        events.delete(sink)
        drainedIfEmpty()
      }
    },
    async join(chat_id) {
      if (refuseJoin) throw new VoiceRefusal("busy", "this account is already on a call")
      joined.push(chat_id)
      status = { ...status, state: "in_call", chat_id, call_id: CALL.call_id, thread_id: "1759000000.000100" }
      return CALL
    },
    async leave() {
      status = { ...status, state: "idle" }
    },
    async speak(pcm16, sample_rate) {
      spoken.push({ pcm: pcm16, rate: sample_rate })
    },
    async setCapture(on) {
      status = { ...status, capturing: on }
    },
    async stats() {
      return { outbound: { packetsSent: 455 } }
    },
  }
  return {
    control,
    spoken,
    joined,
    refuse: () => {
      refuseJoin = true
    },
    emitEvent: (event: CallEvent) => {
      for (const sink of events) sink(event)
    },
    emitAudio: (frame: AudioFrame) => {
      for (const sink of audio) sink(frame)
    },
    listeners: () => ({ audio: audio.size, events: events.size }),
    // the server's own unsubscribe is the observable; the client's close event fires on the other end
    whenDrained: (): Promise<void> =>
      new Promise((resolve, reject) => {
        if (audio.size === 0 && events.size === 0) {
          resolve()
          return
        }
        const timer = setTimeout(() => reject(new Error("the surface never dropped its subscriptions")), 10_000)
        onDrained = () => {
          clearTimeout(timer)
          resolve()
        }
      }),
  }
}

let server: HuddleServer | null = null
afterEach(async () => {
  await server?.stop()
  server = null
})

const start = (control: HuddleControl): HuddleServer => {
  server = serveHuddle({ driver: control, token: TOKEN })
  return server
}

test("the surface answers only on loopback and only with the token", async () => {
  const fake = fakeDriver()
  const live = start(fake.control)
  expect(new URL(live.url).hostname).toBe("127.0.0.1")

  expect((await fetch(`${live.url}/status`)).status).toBe(401)
  expect((await fetch(`${live.url}/status`, { headers: { authorization: "Bearer wrong" } })).status).toBe(401)
  const refused = await fetch(`${live.url}/join`, { method: "POST", body: JSON.stringify({ chat_id: "C_TEST" }) })
  expect(refused.status).toBe(401)
  expect(fake.joined).toEqual([])

  const allowed = await fetch(`${live.url}/status`, { headers: { authorization: `Bearer ${TOKEN}` } })
  expect(allowed.status).toBe(200)
  expect(await allowed.json()).toMatchObject({ state: "idle", capturing: false })
})

test("join, capture and leave reach the call, and a refusal answers 409 rather than 500", async () => {
  const fake = fakeDriver()
  const live = start(fake.control)
  const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }

  const joined = await fetch(`${live.url}/join`, { method: "POST", headers: auth, body: JSON.stringify({ chat_id: "C_TEST" }) })
  expect(joined.status).toBe(200)
  expect(await joined.json()).toEqual({ call: CALL })
  expect(fake.joined).toEqual(["C_TEST"])

  const noChat = await fetch(`${live.url}/join`, { method: "POST", headers: auth, body: JSON.stringify({}) })
  expect(noChat.status).toBe(400)

  await fetch(`${live.url}/capture`, { method: "POST", headers: auth, body: JSON.stringify({ on: true }) })
  const status = await (await fetch(`${live.url}/status`, { headers: auth })).json()
  expect(status).toMatchObject({ capturing: true, thread_id: "1759000000.000100" })

  fake.refuse()
  const busy = await fetch(`${live.url}/join`, { method: "POST", headers: auth, body: JSON.stringify({ chat_id: "C_OTHER" }) })
  expect(busy.status).toBe(409)
  expect(await busy.json()).toMatchObject({ reason: "busy" })

  expect((await fetch(`${live.url}/leave`, { method: "POST", headers: auth })).status).toBe(200)
})

test("posted audio reaches the call unchanged", async () => {
  const fake = fakeDriver()
  const live = start(fake.control)
  const pcm16 = syntheticTone({ seconds: 0.02, hz: 440, sample_rate: 24000, amplitude: 0.5 })
  const body = encodeAudioFrame({ direction: "outbound", sample_rate: 24000, at_ms: 0, speaker: null, pcm16 })
  const response = await fetch(`${live.url}/speak`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body })
  expect(response.status).toBe(200)
  expect(fake.spoken).toHaveLength(1)
  expect(fake.spoken[0]?.rate).toBe(24000)
  expect(Array.from(fake.spoken[0]?.pcm ?? [])).toEqual(Array.from(pcm16))
})

test("the stream carries events as text and inbound audio as binary, and drops its subscriptions on close", async () => {
  const fake = fakeDriver()
  const live = start(fake.control)
  const socket = new WebSocket(`${live.url.replace("http", "ws")}/stream`, [`omo-huddle.${TOKEN}`])
  socket.binaryType = "arraybuffer"

  const inbox: unknown[] = []
  const nextMessages = (count: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`only ${inbox.length} of ${count} messages arrived`)), 10_000)
      socket.addEventListener("message", (event) => {
        inbox.push(event.data)
        if (inbox.length < count) return
        clearTimeout(timer)
        resolve()
      })
      socket.addEventListener("error", () => reject(new Error("the stream refused the connection")))
    })

  const arrived = nextMessages(3)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve())
    socket.addEventListener("error", () => reject(new Error("the stream refused the token")))
  })
  expect(fake.listeners()).toEqual({ audio: 1, events: 1 })

  fake.emitEvent({ kind: "joined", call: CALL, by: { platform_user_id: "U_SELF", display: "self", attribution: "exact" }, roster: [] })
  fake.emitAudio({ call: CALL, speaker: { platform_user_id: "U_OTHER", display: "U_OTHER", attribution: "roster" }, pcm16: new Int16Array([5, 6, 7]), sample_rate: 48000, at_ms: 42 })
  await arrived

  expect(JSON.parse(String(inbox[0]))).toMatchObject({ kind: "hello" })
  expect(JSON.parse(String(inbox[1]))).toMatchObject({ kind: "joined" })
  const binary = inbox[2]
  expect(binary).toBeInstanceOf(ArrayBuffer)
  const frame = decodeAudioFrame(new Uint8Array(binary instanceof ArrayBuffer ? binary : new ArrayBuffer(0)))
  expect(frame.sample_rate).toBe(48000)
  expect(frame.speaker?.platform_user_id).toBe("U_OTHER")
  expect(Array.from(frame.pcm16)).toEqual([5, 6, 7])

  const drained = fake.whenDrained()
  socket.close()
  await drained
  expect(fake.listeners()).toEqual({ audio: 0, events: 0 })
})

test("the stream refuses a connection that carries no token", async () => {
  const fake = fakeDriver()
  const live = start(fake.control)
  const socket = new WebSocket(`${live.url.replace("http", "ws")}/stream`)
  const outcome = await new Promise<string>((resolve) => {
    socket.addEventListener("open", () => resolve("opened"))
    socket.addEventListener("error", () => resolve("refused"))
    socket.addEventListener("close", () => resolve("refused"))
  })
  expect(outcome).toBe("refused")
  expect(fake.listeners()).toEqual({ audio: 0, events: 0 })
})
