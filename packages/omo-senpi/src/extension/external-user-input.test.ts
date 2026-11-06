/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import {
  enableFakeExtensionEvents,
  FakeExtensionAPI,
  fakeExtensionEventHandlerCount,
} from "../../test-support/fake-extension-api"
import { installExternalUserInputApi, type ExternalUserInputRequest } from "./external-user-input"

const EVENT = "omo:send-user-input"
const context = (id: string) => ({ sessionManager: { getSessionId: () => id } })
const input = (inputId: string) => ({
  type: "input", source: "extension", inputId, text: "ulw fix it",
})

async function createSession(id = "host") {
  const pi = new FakeExtensionAPI()
  enableFakeExtensionEvents(pi)
  installExternalUserInputApi(pi)
  await pi.dispatch("session_start", {}, context(id))
  return pi
}

function send(pi: FakeExtensionAPI, action: () => Promise<unknown>, sessionId = "host") {
  let result: Promise<unknown> | undefined
  const request: ExternalUserInputRequest = { sessionId, send: () => { result = action() } }
  pi.events?.emit(EVENT, request)
  return { request, result }
}

describe("explicit external input attribution", () => {
  it("preserves the actual event fields while classifying external input for every handler", async () => {
    // Given native input handlers and image/queue metadata.
    const pi = await createSession()
    const observed: unknown[] = []
    pi.on("input", (payload) => { observed.push(payload) })
    pi.on("input", (payload) => { observed.push(payload) })
    const payload = { ...input("host:1"), images: [{ type: "image", data: "image" }], streamingBehavior: "followUp" }

    // When the host dispatches the explicit send.
    const submitted = send(pi, () => pi.dispatch("input", payload, context("host")))
    await submitted.result

    // Then all OMO handlers share provenance without mutating the host event.
    expect(submitted.request.handled).toBe(true)
    expect(observed).toEqual([{ ...payload, source: "rpc" }, { ...payload, source: "rpc" }])
    expect(payload.source).toBe("extension")
  })

  it("keeps ordinary extensions suppressed even if their text equals a external submission", async () => {
    // Given a source-recording handler.
    const pi = await createSession()
    const observed: unknown[] = []
    pi.on("input", (payload) => { observed.push(payload) })
    await send(pi, () => pi.dispatch("input", input("host:1"), context("host"))).result

    // When an ordinary extension later sends identical text.
    await pi.dispatch("input", input("host:2"), context("host"))

    // Then matching text cannot grant human provenance.
    expect(observed).toEqual([{ ...input("host:1"), source: "rpc" }, input("host:2")])
  })

  it("retains attribution across host awaits and awaits asynchronous transforms", async () => {
    // Given a host barrier and asynchronous transform handlers.
    const pi = await createSession()
    const barrier = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const transformed = Promise.withResolvers<void>()
    pi.on("input", async () => {
      entered.resolve()
      await barrier.promise
      transformed.resolve()
      return { action: "transform", text: "transformed", images: [{ type: "image" }] }
    })
    let classified: unknown
    pi.on("input", (payload) => { classified = payload })

    // When send returns before the host finishes its async input work.
    const submitted = send(pi, async () => {
      await Promise.resolve()
      return pi.dispatch("input", input("host:1"), context("host"))
    })
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        entered.promise,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("Input hook did not reach its barrier")), 2_000)
        }),
      ])
    } finally {
      clearTimeout(timeout)
      barrier.resolve()
    }
    const results = await submitted.result
    await transformed.promise

    // Then the host sees transform results and later handlers see real-user input.
    expect(results).toEqual([undefined, { action: "transform", text: "transformed", images: [{ type: "image" }] }, undefined])
    expect(classified).toEqual({ ...input("host:1"), source: "rpc" })
  }, 5000)

  it("does not attribute later programmatic inputs inheriting the same async context", async () => {
    // Given one explicit external submission.
    const pi = await createSession()
    const observed: unknown[] = []
    pi.on("input", (payload) => { observed.push(payload) })

    // When its async continuation sends a different host input.
    await send(pi, async () => {
      await pi.dispatch("input", input("host:1"), context("host"))
      await pi.dispatch("input", input("host:2"), context("host"))
    }).result

    // Then only the initiating input is human.
    expect(observed).toEqual([{ ...input("host:1"), source: "rpc" }, input("host:2")])
  })

  it("isolates overlapping external submissions", async () => {
    // Given two host preflight barriers.
    const pi = await createSession()
    const first = Promise.withResolvers<void>()
    const second = Promise.withResolvers<void>()
    const observed: unknown[] = []
    pi.on("input", (payload) => { observed.push(payload) })
    const a = send(pi, async () => { await first.promise; return pi.dispatch("input", input("host:1"), context("host")) })
    const b = send(pi, async () => { await second.promise; return pi.dispatch("input", input("host:2"), context("host")) })

    // When the second submission reaches preflight first.
    second.resolve()
    await b.result
    first.resolve()
    await a.result

    // Then each retains its own host ID.
    expect(observed).toEqual([{ ...input("host:2"), source: "rpc" }, { ...input("host:1"), source: "rpc" }])
  }, 5000)

  it("routes a shared bus to the matching durable host session only", async () => {
    // Given two sessions sharing a host event bus.
    const pi = await createSession("first")
    const second = new FakeExtensionAPI()
    second.events = pi.events
    installExternalUserInputApi(second)
    await second.dispatch("session_start", {}, context("second"))
    const observed: unknown[] = []
    second.on("input", (payload) => { observed.push(payload) })

    // When the second host session is targeted.
    const submitted = send(pi, () => second.dispatch("input", input("second:1"), context("second")), "second")
    await submitted.result

    // Then one matching listener claims and attributes the send.
    expect(submitted.request.handled).toBe(true)
    expect(observed).toEqual([{ ...input("second:1"), source: "rpc" }])
  })

  it("leaves unmatched requests available for the producer's normal fallback", async () => {
    // Given a live session.
    const pi = await createSession()
    let calls = 0
    const malformed: unknown[] = [null, [], {}, { sessionId: "host", send: "bad" },
      { sessionId: "", send() {} }, { sessionId: "host", send() {}, handled: "bad" }]

    // When invalid or foreign requests are emitted.
    for (const value of malformed) pi.events?.emit(EVENT, value)
    const request = { sessionId: "gateway-not-host", send() { calls += 1 } }
    pi.events?.emit(EVENT, request)

    // Then no send has been claimed or performed.
    expect(calls).toBe(0)
    expect(request).toEqual({ sessionId: "gateway-not-host", send: request.send })
  })

  it("unsubscribes and invalidates an in-flight submission on shutdown", async () => {
    // Given an input waiting before preflight.
    const pi = await createSession()
    const barrier = Promise.withResolvers<void>()
    const observed: unknown[] = []
    pi.on("input", (payload) => { observed.push(payload) })
    const submitted = send(pi, async () => { await barrier.promise; return pi.dispatch("input", input("host:1"), context("host")) })

    // When the session shuts down before the input arrives.
    await pi.dispatch("session_shutdown", {}, context("host"))
    barrier.resolve()
    await submitted.result

    // Then stale sends cannot gain provenance and the bus listener is gone.
    expect(observed).toEqual([input("host:1")])
    expect(fakeExtensionEventHandlerCount(pi, EVENT)).toBe(0)
  }, 5000)

  it("uses the current session manager ID after a session switch", async () => {
    // Given a live manager whose session changes.
    const pi = await createSession()
    let id = "host"
    const ctx = { sessionManager: { getSessionId: () => id } }
    await pi.dispatch("session_start", {}, ctx)
    const observed: unknown[] = []
    pi.on("input", (payload) => { observed.push(payload) })
    id = "new"

    // When a new session's explicit input is dispatched.
    const stale = send(pi, () => pi.dispatch("input", input("host:1"), ctx))
    await send(pi, () => pi.dispatch("input", input("new:1"), ctx), "new").result

    // Then the stale request stays unclaimed.
    expect(stale.request.handled).toBeUndefined()
    expect(observed).toEqual([{ ...input("new:1"), source: "rpc" }])
  })

  it("does not change native RPC, interactive, or ID-less extension events", async () => {
    // Given registered handlers.
    const pi = await createSession()
    const observed: unknown[] = []
    pi.on("input", (payload) => { observed.push(payload) })
    const values = [{ ...input("host:1"), source: "rpc" }, { ...input("host:2"), source: "interactive" },
      { type: "input", source: "extension", text: "ulw" }]

    // When the native events arrive.
    for (const value of values) await send(pi, () => pi.dispatch("input", value, context("host"))).result

    // Then their original provenance is preserved.
    expect(observed).toEqual(values)
  })

  it("leaves hosts without an event bus untouched", () => {
    // Given a host without events.
    const pi = new FakeExtensionAPI()
    const nativeOn = pi.on

    // When the optional bridge installs.
    installExternalUserInputApi(pi)

    // Then the normal host registration remains unchanged.
    expect(pi.on).toBe(nativeOn)
    expect(pi.handlers).toHaveLength(0)
  })

  it("preserves modern host event registration options", async () => {
    // Given an adapter with the shared input wrapper installed.
    const pi = await createSession()
    const handler = () => undefined
    const options = { previewSafe: true }

    // When another component registers its preview-safe hook.
    pi.on("before_agent_start", handler, options)
    pi.on("input", handler, options)

    // Then wrapping does not discard host registration metadata.
    expect(pi.handlers.slice(-2).map((registration) => registration.options)).toEqual([options, options])
    expect(pi.handlers.at(-2)?.handler).toBe(handler)
  })
})
