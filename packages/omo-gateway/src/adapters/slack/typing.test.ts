import { afterEach, beforeEach, expect, test } from "bun:test"
import { SlackTypingUnavailable } from "./outbound"
import { FakeSlackServer } from "./testing/fake-server"
import { FAKE_CHAT } from "./testing/fake-state"
import { adapterFor, ManualClock, startListening } from "./testing/harness"

let server: FakeSlackServer

beforeEach(() => {
  server = new FakeSlackServer()
})

afterEach(() => {
  server.stop()
})

const text = (value: string) => [{ t: "text" as const, text: value }]

test("N typing + post pairs dial rtm.connect once and open one realtime line", async () => {
  const adapter = adapterFor(server)
  const thread = { ...server.chat(), thread_id: server.humanPost({ channel: FAKE_CHAT, text: "root" }).ts }
  for (let index = 0; index < 5; index += 1) {
    await adapter.send({ op: "typing", key: thread })
    await adapter.send({ op: "post", key: thread, body: text(`reply ${index}`) })
  }
  await server.framesReceived(5)
  adapter.close()
  expect(server.counters.rtmConnects).toBe(1)
  expect(server.socketsOpened).toBe(1)
  expect(server.peakOpenSockets).toBe(1)
  expect(server.typingFrames).toHaveLength(5)
  expect(server.typingFrames[0]).toMatchObject({ type: "user_typing", channel: FAKE_CHAT, thread_ts: thread.thread_id })
  expect(server.at(thread).map((message) => server.state.plain(message))).toEqual([0, 1, 2, 3, 4].map((index) => `reply ${index}`))
})

test("typing while listening rides the listening socket: still one rtm.connect, one socket", async () => {
  const adapter = adapterFor(server)
  const listening = startListening(adapter)
  await listening.ready
  for (let index = 0; index < 3; index += 1) await adapter.send({ op: "typing", key: server.chat() })
  await server.framesReceived(3)
  await listening.stop()
  expect(server.counters.rtmConnects).toBe(1)
  expect(server.socketsOpened).toBe(1)
  expect(server.typingFrames).toHaveLength(3)
})

test("a hung rtm.connect: typing gives up at the budget and the post still lands, without typing", async () => {
  const clock = new ManualClock()
  const adapter = adapterFor(server, "user", { clock, typingBudgetMs: 2500 })
  server.failNext("rtm.connect", { hang: true })
  const typing = adapter.send({ op: "typing", key: server.chat() }).then(
    () => null,
    (error: unknown) => error,
  )
  clock.advance(2500)
  expect(await typing).toBeInstanceOf(SlackTypingUnavailable)
  const posted = await adapter.send({ op: "post", key: server.chat(), body: text("posted anyway") })
  expect(server.state.find(FAKE_CHAT, posted.message_id)?.text).toBe("posted anyway")
  expect(server.typingFrames).toHaveLength(0)
  clock.advance(30_000)
  expect(server.callsOf("rtm.connect")).toHaveLength(1)
})
