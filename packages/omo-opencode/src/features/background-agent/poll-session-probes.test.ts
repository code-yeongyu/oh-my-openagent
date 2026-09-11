import { describe, expect, test } from "bun:test"
import { resolvePollSessionProbes } from "./poll-session-probes"
import type { PollProbeResolvers, PollProbeTarget } from "./poll-session-probes"

interface ProbeRecorder {
  readonly calls: string[]
  readonly maxInFlight: number
  resolving: (value: boolean) => (sessionID: string) => Promise<boolean>
  rejecting: (failingSessionID: string, value: boolean) => (sessionID: string) => Promise<boolean>
}

function createProbeRecorder(label: string): ProbeRecorder {
  const calls: string[] = []
  let inFlight = 0
  let maxInFlight = 0

  async function enter(sessionID: string): Promise<void> {
    calls.push(`${label}:${sessionID}`)
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 5))
    inFlight -= 1
  }

  return {
    calls,
    get maxInFlight() {
      return maxInFlight
    },
    resolving: (value) => async (sessionID) => {
      await enter(sessionID)
      return value
    },
    rejecting: (failingSessionID, value) => async (sessionID) => {
      await enter(sessionID)
      if (sessionID === failingSessionID) throw new Error(`probe failed for ${sessionID}`)
      return value
    },
  }
}

function createResolvers(overrides: Partial<PollProbeResolvers> = {}): PollProbeResolvers {
  return {
    validateSessionHasOutput: async () => true,
    verifySessionExists: async () => true,
    checkSessionTodos: async () => false,
    ...overrides,
  }
}

function targetsFor(sessionIDs: string[], requiresExistenceCheck = false): PollProbeTarget[] {
  return sessionIDs.map((sessionID) => ({ sessionID, requiresExistenceCheck }))
}

describe("resolvePollSessionProbes", () => {
  describe("#given many sessions to probe", () => {
    test("#when resolving #then every output probe is in flight at the same time", async () => {
      //#given
      const output = createProbeRecorder("output")
      const sessionIDs = ["ses-1", "ses-2", "ses-3", "ses-4", "ses-5"]

      //#when
      const results = await resolvePollSessionProbes(
        targetsFor(sessionIDs),
        createResolvers({ validateSessionHasOutput: output.resolving(true) }),
      )

      //#then
      expect(output.maxInFlight).toBe(sessionIDs.length)
      expect(results.hasOutput.size).toBe(sessionIDs.length)
    })

    test("#when every session has output #then the todo probes also overlap", async () => {
      //#given
      const todos = createProbeRecorder("todo")
      const sessionIDs = ["ses-1", "ses-2", "ses-3", "ses-4"]

      //#when
      await resolvePollSessionProbes(
        targetsFor(sessionIDs),
        createResolvers({ checkSessionTodos: todos.resolving(false) }),
      )

      //#then
      expect(todos.maxInFlight).toBe(sessionIDs.length)
    })
  })

  describe("#given a session that produced output", () => {
    test("#when resolving #then only the todo probe follows", async () => {
      //#given
      const todos = createProbeRecorder("todo")
      const existence = createProbeRecorder("existence")

      //#when
      const results = await resolvePollSessionProbes(
        targetsFor(["ses-1"], true),
        createResolvers({
          validateSessionHasOutput: async () => true,
          checkSessionTodos: todos.resolving(true),
          verifySessionExists: existence.resolving(true),
        }),
      )

      //#then
      expect(todos.calls).toEqual(["todo:ses-1"])
      expect(existence.calls).toEqual([])
      expect(results.hasIncompleteTodos.get("ses-1")).toBe(true)
      expect(results.sessionExists.has("ses-1")).toBe(false)
    })
  })

  describe("#given a session without output that reached the missed poll threshold", () => {
    test("#when resolving #then only the existence probe follows", async () => {
      //#given
      const todos = createProbeRecorder("todo")
      const existence = createProbeRecorder("existence")

      //#when
      const results = await resolvePollSessionProbes(
        targetsFor(["ses-1"], true),
        createResolvers({
          validateSessionHasOutput: async () => false,
          checkSessionTodos: todos.resolving(false),
          verifySessionExists: existence.resolving(false),
        }),
      )

      //#then
      expect(existence.calls).toEqual(["existence:ses-1"])
      expect(todos.calls).toEqual([])
      expect(results.sessionExists.get("ses-1")).toBe(false)
      expect(results.hasIncompleteTodos.has("ses-1")).toBe(false)
    })
  })

  describe("#given a session without output that does not need an existence check", () => {
    test("#when resolving #then no follow up probe runs", async () => {
      //#given
      const todos = createProbeRecorder("todo")
      const existence = createProbeRecorder("existence")

      //#when
      const results = await resolvePollSessionProbes(
        targetsFor(["ses-1"], false),
        createResolvers({
          validateSessionHasOutput: async () => false,
          checkSessionTodos: todos.resolving(false),
          verifySessionExists: existence.resolving(true),
        }),
      )

      //#then
      expect(todos.calls).toEqual([])
      expect(existence.calls).toEqual([])
      expect(results.hasOutput.get("ses-1")).toBe(false)
    })
  })

  describe("#given the same session appears twice with different existence flags", () => {
    test("#when resolving #then each probe runs once and the existence check is kept", async () => {
      //#given
      const output = createProbeRecorder("output")
      const existence = createProbeRecorder("existence")
      const targets: PollProbeTarget[] = [
        { sessionID: "ses-1", requiresExistenceCheck: false },
        { sessionID: "ses-1", requiresExistenceCheck: true },
      ]

      //#when
      await resolvePollSessionProbes(
        targets,
        createResolvers({
          validateSessionHasOutput: output.resolving(false),
          verifySessionExists: existence.resolving(true),
        }),
      )

      //#then
      expect(output.calls).toEqual(["output:ses-1"])
      expect(existence.calls).toEqual(["existence:ses-1"])
    })
  })

  describe("#given one output probe rejects", () => {
    test("#when resolving #then the entry stays unset and the other sessions still resolve", async () => {
      //#given
      const output = createProbeRecorder("output")
      const reported: string[] = []

      //#when
      const results = await resolvePollSessionProbes(
        targetsFor(["ses-1", "ses-2"]),
        createResolvers({ validateSessionHasOutput: output.rejecting("ses-1", true) }),
        (sessionID) => {
          reported.push(sessionID)
        },
      )

      //#then
      expect(results.hasOutput.has("ses-1")).toBe(false)
      expect(results.hasOutput.get("ses-2")).toBe(true)
      expect(reported).toEqual(["ses-1"])
    })
  })

  describe("#given no targets", () => {
    test("#when resolving #then no probe runs", async () => {
      //#given
      const output = createProbeRecorder("output")

      //#when
      const results = await resolvePollSessionProbes(
        [],
        createResolvers({ validateSessionHasOutput: output.resolving(true) }),
      )

      //#then
      expect(output.calls).toEqual([])
      expect(results.hasOutput.size).toBe(0)
    })
  })
})
