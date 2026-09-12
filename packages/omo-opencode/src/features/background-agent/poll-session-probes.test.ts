import { describe, expect, test } from "bun:test"
import { startPollSessionProbes } from "./poll-session-probes"
import type { PollProbeResolvers, PollProbeTarget, PollSessionProbeBatch, PollSessionProbeResult } from "./poll-session-probes"

function createResolvers(overrides: Partial<PollProbeResolvers> = {}): PollProbeResolvers {
  return {
    validateSessionHasOutput: async () => true,
    verifySessionExists: async () => true,
    checkSessionTodos: async () => false,
    ...overrides,
  }
}

function getProbeResult(batch: PollSessionProbeBatch, sessionID: string): Promise<PollSessionProbeResult> {
  const result = batch.resultsBySession.get(sessionID)
  if (!result) {
    throw new Error(`missing probe result for ${sessionID}`)
  }
  return result
}

describe("startPollSessionProbes", () => {
  describe("#given a session that produced output", () => {
    test("#when resolving #then only the todo probe follows", async () => {
      //#given
      const calls: string[] = []
      const batch = startPollSessionProbes([{ sessionID: "ses-1", requiresExistenceCheck: true }], {
        resolvers: createResolvers({
          checkSessionTodos: async () => {
            calls.push("todos")
            return true
          },
          verifySessionExists: async () => {
            calls.push("existence")
            return true
          },
        }),
      })

      //#when
      const result = await getProbeResult(batch, "ses-1")

      //#then
      expect(calls).toEqual(["todos"])
      expect(result.hasIncompleteTodos).toBe(true)
      expect(result.sessionExists).toBeUndefined()
    })
  })

  describe("#given a session without output at the missed-poll threshold", () => {
    test("#when resolving #then only the existence probe follows", async () => {
      //#given
      const calls: string[] = []
      const batch = startPollSessionProbes([{ sessionID: "ses-1", requiresExistenceCheck: true }], {
        resolvers: createResolvers({
          validateSessionHasOutput: async () => false,
          checkSessionTodos: async () => {
            calls.push("todos")
            return false
          },
          verifySessionExists: async () => {
            calls.push("existence")
            return false
          },
        }),
      })

      //#when
      const result = await getProbeResult(batch, "ses-1")

      //#then
      expect(calls).toEqual(["existence"])
      expect(result.sessionExists).toBe(false)
      expect(result.hasIncompleteTodos).toBeUndefined()
    })
  })

  describe("#given a session without output that does not need existence verification", () => {
    test("#when resolving #then no follow-up probe runs", async () => {
      //#given
      const calls: string[] = []
      const batch = startPollSessionProbes([{ sessionID: "ses-1", requiresExistenceCheck: false }], {
        resolvers: createResolvers({
          validateSessionHasOutput: async () => false,
          checkSessionTodos: async () => {
            calls.push("todos")
            return false
          },
          verifySessionExists: async () => {
            calls.push("existence")
            return true
          },
        }),
      })

      //#when
      const result = await getProbeResult(batch, "ses-1")

      //#then
      expect(calls).toEqual([])
      expect(result.hasOutput).toBe(false)
    })
  })

  describe("#given duplicate sessions with different existence requirements", () => {
    test("#when resolving #then one output probe retains the existence requirement", async () => {
      //#given
      let outputCalls = 0
      let existenceCalls = 0
      const targets: PollProbeTarget[] = [
        { sessionID: "ses-1", requiresExistenceCheck: false },
        { sessionID: "ses-1", requiresExistenceCheck: true },
      ]
      const batch = startPollSessionProbes(targets, {
        resolvers: createResolvers({
          validateSessionHasOutput: async () => {
            outputCalls += 1
            return false
          },
          verifySessionExists: async () => {
            existenceCalls += 1
            return true
          },
        }),
      })

      //#when
      await getProbeResult(batch, "ses-1")

      //#then
      expect(outputCalls).toBe(1)
      expect(existenceCalls).toBe(1)
    })
  })

  describe("#given a rejecting output probe", () => {
    test("#when resolving #then its result is unset and other sessions keep resolving", async () => {
      //#given
      const reported: string[] = []
      const batch = startPollSessionProbes([
        { sessionID: "ses-failing", requiresExistenceCheck: false },
        { sessionID: "ses-ready", requiresExistenceCheck: false },
      ], {
        resolvers: createResolvers({
          validateSessionHasOutput: async (sessionID) => {
            if (sessionID === "ses-failing") {
              throw new Error("probe failure")
            }
            return true
          },
        }),
        onProbeError: (sessionID, probe) => reported.push(`${probe}:${sessionID}`),
      })

      //#when
      const [failing, ready] = await Promise.all([
        getProbeResult(batch, "ses-failing"),
        getProbeResult(batch, "ses-ready"),
      ])

      //#then
      expect(failing.hasOutput).toBeUndefined()
      expect(ready.hasOutput).toBe(true)
      expect(reported).toEqual(["output:ses-failing"])
    })
  })

  describe("#given no targets", () => {
    test("#when starting probes #then the result map is empty", () => {
      //#given
      const batch = startPollSessionProbes([], { resolvers: createResolvers() })

      //#when
      const resultCount = batch.resultsBySession.size

      //#then
      expect(resultCount).toBe(0)
    })
  })
})
