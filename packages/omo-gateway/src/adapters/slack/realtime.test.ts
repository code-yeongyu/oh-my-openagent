import { afterEach, beforeEach, expect, test } from "bun:test"
import { AdapterFatal } from "../../adapter/contract"
import { SlackAuthError } from "./api"
import { FakeSlackServer } from "./testing/fake-server"
import { FAKE_CHAT } from "./testing/fake-state"
import { adapterFor, fastClock, ManualClock, startListening } from "./testing/harness"

let server: FakeSlackServer

beforeEach(() => {
  server = new FakeSlackServer()
})

afterEach(() => {
  server.stop()
})

test("a dropped RTM line reconnects with one socket at a time and the message is delivered once", async () => {
  const adapter = adapterFor(server)
  const listening = startListening(adapter)
  await listening.ready
  const reopened = server.nextOpen()
  server.dropSockets()
  await reopened
  server.humanPost({ channel: FAKE_CHAT, text: "after the drop" })
  await listening.waitFor((event) => event.text === "after the drop", "the post after the reconnect")
  await listening.stop()
  expect(server.socketsOpened).toBe(2)
  expect(server.peakOpenSockets).toBe(1)
  expect(listening.events.filter((event) => event.text === "after the drop")).toHaveLength(1)
})

test("token_revoked on rtm.connect: listen rejects with AdapterFatal, and nothing calls Slack again", async () => {
  const adapter = adapterFor(server, "user")
  server.failNext("rtm.connect", { error: "token_revoked" })
  const failed = await startListening(adapter).done
  expect(failed).toBeInstanceOf(SlackAuthError)
  expect(failed instanceof AdapterFatal ? [failed.platform, failed.reason] : null).toEqual(["slack", "token_revoked"])
  expect(String(failed)).not.toContain("xoxc-")
  const callsAfterStop = server.calls.length
  expect(await startListening(adapter).done).toBe(failed)
  expect(await adapter.send({ op: "post", key: server.chat(), body: [{ t: "text", text: "x" }] }).catch((error: unknown) => error)).toBe(failed)
  expect(server.calls.length).toBe(callsAfterStop)
})

test("invalid_auth on auth.test: listen rejects with AdapterFatal before any realtime line is dialed", async () => {
  server.failNext("auth.test", { error: "invalid_auth" })
  const failed = await startListening(adapterFor(server, "user")).done
  expect(failed instanceof AdapterFatal ? failed.reason : failed).toBe("invalid_auth")
  expect(server.counters.rtmConnects).toBe(0)
})

test("a 429 on rtm.connect waits Retry-After on the clock, then connects", async () => {
  const clock = fastClock()
  server.failNext("rtm.connect", { status: 429, retryAfter: 7 })
  const listening = startListening(adapterFor(server, "user", { clock }))
  await listening.ready
  await listening.stop()
  expect(clock.slept).toContain(7000)
  expect(server.counters.rtmConnects).toBe(1)
})

test("repeated dial failures back off exponentially up to the cap and never open a second socket", async () => {
  const clock = fastClock()
  for (let index = 0; index < 7; index += 1) server.failNext("rtm.connect", { error: "internal_error" })
  const listening = startListening(adapterFor(server, "user", { clock }))
  await listening.ready
  await listening.stop()
  expect(clock.slept).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
  expect(server.peakOpenSockets).toBe(1)
})

test("a missing pong closes the line after the bound and the adapter reconnects", async () => {
  const clock = new ManualClock()
  const listening = startListening(adapterFor(server, "user", { clock }))
  await listening.ready
  server.answerPings = false
  const reopened = server.nextOpen()
  clock.advance(30_000)
  clock.advance(10_000)
  await reopened
  await listening.stop()
  expect(server.socketsOpened).toBe(2)
})

test("a socket that never says hello is closed at the bound and retried", async () => {
  const clock = new ManualClock()
  server.helloOnOpen = false
  const firstOpen = server.nextOpen()
  const listening = startListening(adapterFor(server, "user", { clock }))
  await firstOpen
  server.helloOnOpen = true
  const reopened = server.nextOpen()
  clock.advance(30_000)
  await reopened
  await listening.ready
  await listening.stop()
  expect(server.socketsOpened).toBe(2)
})

test("socket mode acks every envelope, reconnects on disconnect, and link_disabled stops with AdapterFatal", async () => {
  const adapter = adapterFor(server, "bot")
  const listening = startListening(adapter)
  await listening.ready
  server.humanPost({ channel: FAKE_CHAT, text: "over socket mode" })
  await listening.waitFor((event) => event.text === "over socket mode", "the socket mode event")
  await server.until("an ack for every envelope", () => server.acks.length === server.envelopesSent)
  expect(server.envelopesSent).toBeGreaterThan(0)
  const reopened = server.nextOpen()
  server.sendRaw(JSON.stringify({ type: "disconnect", reason: "refresh_requested" }))
  await reopened
  server.sendRaw(JSON.stringify({ type: "disconnect", reason: "link_disabled" }))
  const done = await listening.done
  expect(done instanceof AdapterFatal ? done.reason : done).toBe("link_disabled")
  expect(server.counters.socketOpens).toBe(2)
})

test("one listen per adapter: a second concurrent listen is refused", async () => {
  const adapter = adapterFor(server)
  const first = startListening(adapter)
  await first.ready
  expect(await startListening(adapter).done).toBeInstanceOf(Error)
  await first.stop()
  expect(server.peakOpenSockets).toBe(1)
})
