/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"

import { TOOLKIT_GRANT_RPC } from "./index"
import { cleanup, content, execute, mcp, session, setup } from "./thread-tools-test-support"

afterEach(cleanup)

describe("desktop thread discovery lifecycle", () => {
  for (const deferred of [false, true]) {
    it(`#given a grant sent only after startup returns #when deferral is ${deferred} #then discovery registers without deadlock`, async () => {
      const stub = await mcp()
      const host = await setup({ deferred })
      await host.dispatchStart()
      if (deferred) {
        expect(host.pi.rpcEvents).toHaveLength(0)
        expect(host.deferred).toHaveLength(1)
      }
      const discovery = host.flushStartup()
      const request = await host.requested
      expect(host.handlers.get(TOOLKIT_GRANT_RPC)?.({ requestId: request.requestId, grant: stub.grant })).toEqual({ accepted: true })
      await discovery
      await host.registered
      expect(host.tools()).toHaveLength(1)
      await host.turn()
      expect(host.pi.rpcEvents).toHaveLength(1)
    }, 5_000)
  }

  for (const failure of ["refusal", "timeout", "discovery"] as const) {
    it(`#given first ${failure} #when a later turn starts #then discovery retries once and registers`, async () => {
      const options = { listFailure: failure === "discovery" }
      const stub = await mcp(options)
      let first = true
      const host = await setup({
        timeoutMs: failure === "timeout" ? 100 : 1_000,
        reply: () => first && failure !== "discovery"
          ? failure === "refusal" ? { refusal: { reason: "denied" } } : undefined
          : { grant: stub.grant },
      })
      await host.start()
      expect(host.tools()).toHaveLength(0)
      first = false
      options.listFailure = false
      await host.turn()
      await host.registered
      expect(host.tools()).toHaveLength(1)
      expect(host.pi.rpcEvents).toHaveLength(2)
      await host.turn()
      expect(host.pi.rpcEvents).toHaveLength(2)
    })
  }

  it("#given persistent refusal #when turns start #then each turn makes at most one bounded attempt", async () => {
    const host = await setup({ reply: () => ({ refusal: { reason: "denied" } }) })
    await host.start()
    for (let turn = 1; turn <= 3; turn++) {
      const settled = host.failures(turn + 1)
      await host.turn()
      await settled
      expect(host.pi.rpcEvents).toHaveLength(turn + 1)
    }
  })

  it("#given an app that never answers #when later turns start #then they retry in the background without waiting for the timeout", async () => {
    const host = await setup({ timeoutMs: 300 })
    await host.start()
    expect(host.failureCount()).toBe(1)
    // A waited retry would hold this turn for the full 300 ms grant timeout, logging the second failure first.
    await host.turn()
    expect(host.pi.rpcEvents).toHaveLength(2)
    expect(host.failureCount()).toBe(1)
    const settled = host.failures(2)
    await settled
    await host.turn()
    expect(host.pi.rpcEvents).toHaveLength(3)
    expect(host.failureCount()).toBe(2)
  })

  it("#given deferred startup #when the first turn beats the scheduler #then it registers once before the turn returns", async () => {
    const stub = await mcp()
    const host = await setup({ reply: () => ({ grant: stub.grant }) })
    await host.dispatchStart()
    await host.turn()
    expect(host.tools()).toHaveLength(1)
    await host.flushStartup()
    expect(host.pi.rpcEvents).toHaveLength(1)
  })

  it("#given discovery in flight #when a turn starts #then it joins rather than acquiring again", async () => {
    const released = Promise.withResolvers<void>()
    const stub = await mcp({ holdList: released.promise })
    const host = await setup({ reply: () => ({ grant: stub.grant }) })
    const discovery = host.start()
    await stub.listStarted
    const turn = host.turn()
    released.resolve()
    await Promise.all([discovery, turn])
    expect(host.tools()).toHaveLength(1)
    expect(host.pi.rpcEvents).toHaveLength(1)
  })

  it("#given startup queued #when shutdown precedes the scheduler #then no acquisition runs", async () => {
    const stub = await mcp()
    const host = await setup({ reply: () => ({ grant: stub.grant }) })
    await host.dispatchStart()
    await host.shutdown()
    await host.flushStartup()
    await host.turn()
    expect(host.pi.rpcEvents).toHaveLength(0)
    expect(host.tools()).toHaveLength(0)
  })

  it("#given an unanswered grant #when shutdown occurs #then the pending request rejects late delivery", async () => {
    const stub = await mcp()
    const host = await setup()
    const discovery = host.start()
    const request = await host.requested
    await host.shutdown()
    expect(host.handlers.get(TOOLKIT_GRANT_RPC)?.({ requestId: request.requestId, grant: stub.grant })).toEqual({ accepted: false })
    await discovery
    expect(host.tools()).toHaveLength(0)
  })

  it("#given tools/list in flight #when shutdown occurs #then it aborts and cannot register after restart", async () => {
    const released = Promise.withResolvers<void>()
    const options = { holdList: released.promise }
    const stub = await mcp(options)
    const host = await setup({ reply: () => ({ grant: stub.grant }) })
    const discovery = host.start()
    await stub.listStarted
    await host.shutdown()
    await discovery
    expect(stub.closedSessions()).toBe(1)
    expect(host.tools()).toHaveLength(0)
    released.resolve()
    await host.start()
    expect(host.tools()).toHaveLength(1)
    expect(host.pi.rpcEvents).toHaveLength(2)
  })

  it("#given a registered grant #when shutdown and restart use the same id #then the old grant is cleared and discovery can run again", async () => {
    const stub = await mcp()
    const host = await setup({ reply: () => ({ grant: stub.grant }) })
    await host.start()
    const tool = host.tools()[0]
    await host.shutdown()
    expect((await execute(tool)).details).toEqual({ reason: "no_session_grant" })
    await host.start()
    expect(host.pi.rpcEvents).toHaveLength(2)
    expect(host.tools()).toHaveLength(1)
    expect((await execute(tool)).content).toEqual(content)
  })

  it("#given failed startup #when a preview is requested #then it does not retry", async () => {
    const host = await setup({ reply: () => ({ refusal: { reason: "denied" } }) })
    await host.start()
    const registration = host.pi.handlers.find((entry) => entry.event === "before_agent_start")
    // A non-preview-safe handler would make senpi skip the prompt-cache prefix build (senpi#3994).
    expect(registration?.options?.previewSafe).toBe(true)
    await registration?.handler({ type: "before_agent_start", preview: true }, session("A"))
    expect(host.pi.rpcEvents).toHaveLength(1)
  })
})
