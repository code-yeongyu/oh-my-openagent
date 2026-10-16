import { describe, expect, test } from "bun:test"
import { bounded } from "../../lifecycle/__fixtures__/live-parent-fakes"
import { manualRecoveryClock } from "./__fixtures__/manual-recovery-clock"
import { createHostSessionHandle } from "./handle"
import { fakeSessionPort, FAKE_SESSION } from "./handle.test-support"

describe("reattached continuation failure", () => {
  test("a non-transport rejection keeps its cause rather than parking as a daemon outage", async () => {
    // given
    const cause = new Error("the requested tool is disabled")
    const original = fakeSessionPort()
    const promptSent = Promise.withResolvers<void>()
    const reopened = fakeSessionPort(() => {
      promptSent.resolve()
      return Promise.reject(cause)
    })
    const handle = createHostSessionHandle({
      client: original, session: FAKE_SESSION, taskId: "st_rejected_continuation",
      heartbeatIntervalMs: 60_000, now: () => 0, closeGraceMs: 0, openDisposition: "attached",
      reattach: async () => ({ client: reopened, session: FAKE_SESSION, attached: false }),
    })
    const parked: string[] = []
    handle.onParked((event) => parked.push(event.reason))
    try {
      await handle.startInitialPrompt("do the work")
      const outcome = handle.waitForOutcome()
      // when
      original.loseTransport()
      await bounded(promptSent.promise)
      await handle.getEntries()
      // then
      expect(parked).toEqual([])
      expect(await bounded(outcome)).toMatchObject({
        status: "error", failure: { kind: "child-prompt-failed", message: cause.message, cause },
      })
    } finally { await handle.dispose() }
  })

  for (const failure of ["transport", "expiry", "client-timeout", "detach-stall"] as const) {
    test(`${failure} after adoption parks for recovery and releases the adopted connection`, async () => {
      // given
      const original = fakeSessionPort()
      const promptSent = Promise.withResolvers<void>()
      const acknowledgement = Promise.withResolvers<void>()
      const clock = manualRecoveryClock()
      const reopened = fakeSessionPort(() => {
        promptSent.resolve()
        return acknowledgement.promise
      })
      const detachAsked = Promise.withResolvers<void>()
      const detachFinished = Promise.withResolvers<void>()
      if (failure === "detach-stall") {
        const detach = reopened.detach
        reopened.detach = async () => {
          await detach()
          detachAsked.resolve()
          await detachFinished.promise
        }
      }
      const handle = createHostSessionHandle({
        client: original, session: FAKE_SESSION, taskId: "st_parked_continuation",
        heartbeatIntervalMs: 60_000, now: () => 0, closeGraceMs: 0, openDisposition: "attached",
        transportRecovery: { clock },
        reattach: async () => ({ client: reopened, session: FAKE_SESSION, attached: false }),
      })
      const parked = Promise.withResolvers<string>()
      handle.onParked((event) => parked.resolve(event.reason))
      try {
        await handle.startInitialPrompt("do the work")
        // when: expire only after the port was adopted and the continuation was sent
        original.loseTransport()
        await bounded(promptSent.promise)
        if (failure === "expiry") clock.expire()
        else if (failure === "client-timeout") acknowledgement.reject(new Error("Timeout waiting for response to prompt. Stderr: "))
        else acknowledgement.reject(Object.assign(new Error("connection closed"), { code: "rpc_transport_gone" }))
        await bounded(parked.promise)
        if (failure === "detach-stall") {
          await bounded(detachAsked.promise)
          clock.expire()
        }
        await bounded(handle.getEntries())
        // then: detach the connection, not the session needed by contextual recovery
        expect(await parked.promise).toBe("daemon_unavailable")
        expect(reopened.detaches).toBe(1)
        expect(reopened.closes).toBe(0)
        expect(handle.exitOutcome()).toBeUndefined()
        expect(clock.pending()).toBe(0)
      } finally {
        acknowledgement.resolve()
        detachFinished.resolve()
        await handle.dispose()
      }
    })
  }
})
