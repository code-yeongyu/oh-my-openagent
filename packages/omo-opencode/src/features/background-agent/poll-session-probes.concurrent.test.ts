import { describe, expect, test } from "bun:test"
import { MAX_POLL_PROBE_CONCURRENCY, startPollSessionProbes } from "./poll-session-probes"
import type { PollSessionProbeBatch, PollSessionProbeResult } from "./poll-session-probes"

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve: () => resolve?.() }
}

function getProbeResult(batch: PollSessionProbeBatch, sessionID: string): Promise<PollSessionProbeResult> {
  const result = batch.resultsBySession.get(sessionID)
  if (!result) {
    throw new Error(`missing probe result for ${sessionID}`)
  }
  return result
}

describe("startPollSessionProbes concurrency", () => {
  describe("#given more sessions than the configured probe cap", () => {
    test("#when output probes wait #then no more than the cap is in flight", async () => {
      //#given
      const gate = createDeferred()
      const sessionIDs = Array.from({ length: MAX_POLL_PROBE_CONCURRENCY + 2 }, (_, index) => `ses-${index}`)
      let inFlight = 0
      let maxInFlight = 0
      const batch = startPollSessionProbes(
        sessionIDs.map((sessionID) => ({ sessionID, requiresExistenceCheck: false })),
        {
          resolvers: {
            validateSessionHasOutput: async () => {
              inFlight += 1
              maxInFlight = Math.max(maxInFlight, inFlight)
              await gate.promise
              inFlight -= 1
              return false
            },
            verifySessionExists: async () => true,
            checkSessionTodos: async () => false,
          },
        },
      )

      try {
        //#when
        const observedInFlight = maxInFlight
        gate.resolve()
        await Promise.all(sessionIDs.map((sessionID) => getProbeResult(batch, sessionID)))

        //#then
        expect(observedInFlight).toBe(MAX_POLL_PROBE_CONCURRENCY)
      } finally {
        gate.resolve()
      }
    })
  })

  describe("#given a fast session and a different stalled output probe", () => {
    test("#when the fast output resolves #then its todo probe starts without waiting for the stall", async () => {
      //#given
      const slowGate = createDeferred()
      const todoStarted = createDeferred()
      const batch = startPollSessionProbes([
        { sessionID: "ses-fast", requiresExistenceCheck: false },
        { sessionID: "ses-slow", requiresExistenceCheck: false },
      ], {
        resolvers: {
          validateSessionHasOutput: async (sessionID) => {
            if (sessionID === "ses-slow") {
              await slowGate.promise
              return false
            }
            return true
          },
          verifySessionExists: async () => true,
          checkSessionTodos: async () => {
            todoStarted.resolve()
            return false
          },
        },
      })

      try {
        //#when
        await todoStarted.promise
        const fast = await getProbeResult(batch, "ses-fast")

        //#then
        expect(fast.hasIncompleteTodos).toBe(false)
      } finally {
        slowGate.resolve()
        await getProbeResult(batch, "ses-slow")
      }
    })
  })

  describe("#given an output probe that exceeds its deadline", () => {
    test("#when resolving #then only that session's result remains unset", async () => {
      //#given
      const reported: string[] = []
      const batch = startPollSessionProbes([{ sessionID: "ses-hung", requiresExistenceCheck: false }], {
        resolvers: {
          validateSessionHasOutput: () => new Promise<boolean>(() => {}),
          verifySessionExists: async () => true,
          checkSessionTodos: async () => false,
        },
        onProbeError: (_sessionID, probe) => reported.push(probe),
        timeoutMs: 0,
      })

      //#when
      const result = await getProbeResult(batch, "ses-hung")

      //#then
      expect(result.hasOutput).toBeUndefined()
      expect(reported).toEqual(["output"])
    })
  })
})
