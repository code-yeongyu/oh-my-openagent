/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"
import { _resetForTesting, getPendingSwitch, setPendingSwitch } from "./state"
import {
  _resetApplierForTesting,
  applyPendingSwitch,
  clearPendingSwitchRuntime,
} from "./applier"
import { schedulePendingSwitchApply } from "./scheduler"

function createMockClient(overrides?: {
  onPrompt?: (input: { path: { id: string }; body: { agent: string } }) => void
  onCreate?: () => Record<string, unknown>
  onMessages?: () => Record<string, unknown>
  onStatus?: () => Record<string, unknown>
}) {
  return {
    session: {
      create: async () => overrides?.onCreate?.() ?? { data: { id: "new-ses" } },
      promptAsync: async (input: { path: { id: string }; body: { agent: string } }) => {
        overrides?.onPrompt?.(input)
      },
      messages: async () => overrides?.onMessages?.() ?? ({ data: [] }),
      status: overrides?.onStatus ? async () => overrides.onStatus!() : undefined,
    },
  }
}

describe("agent-switch applier", () => {
  beforeEach(() => {
    _resetForTesting()
    _resetApplierForTesting()
  })

  describe("#given fresh session creation flow", () => {
    test("#when scheduled apply runs, #then creates new session and prompts it", async () => {
      const promptedSessions: string[] = []
      const promptedAgents: string[] = []
      const client = createMockClient({
        onCreate: () => ({ data: { id: "fresh-ses-1" } }),
        onPrompt: (input) => {
          promptedSessions.push(input.path.id)
          promptedAgents.push(input.body.agent)
        },
      })

      setPendingSwitch("ses-1", "prometheus", "create plan")
      schedulePendingSwitchApply({
        sessionID: "ses-1",
        client: client as any,
      })

      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(promptedSessions).toEqual(["fresh-ses-1"])
      expect(promptedAgents).toEqual(["Prometheus (Plan Builder)"])
      expect(getPendingSwitch("ses-1")).toBeUndefined()
    })

    test("#when apply runs directly, #then creates fresh session with parentID linking to source", async () => {
      let createInput: Record<string, unknown> | undefined
      const client = {
        session: {
          create: async (input?: { body?: Record<string, unknown> }) => {
            createInput = input?.body
            return { data: { id: "fresh-ses-2" } }
          },
          promptAsync: async () => {},
          messages: async () => ({ data: [] }),
        },
      }

      setPendingSwitch("ses-2", "atlas", "fix now")
      await applyPendingSwitch({
        sessionID: "ses-2",
        client: client as any,
        source: "idle",
      })

      expect(createInput).toEqual({
        parentID: "ses-2",
        title: "atlas (handoff)",
      })
      expect(getPendingSwitch("ses-2")).toBeUndefined()
    })
  })

  describe("#given agent name normalization", () => {
    test("#when agent has canonical display name, #then normalizes for prompt", async () => {
      const promptedAgents: string[] = []
      const client = createMockClient({
        onPrompt: (input) => {
          promptedAgents.push(input.body.agent)
        },
      })

      setPendingSwitch("ses-3", "Prometheus (Plan Builder)", "create plan")
      await applyPendingSwitch({
        sessionID: "ses-3",
        client: client as any,
        source: "idle",
      })

      expect(promptedAgents).toEqual(["Prometheus (Plan Builder)"])
      expect(getPendingSwitch("ses-3")).toBeUndefined()
    })
  })

  describe("#given transient failures", () => {
    test("#when create fails transiently, #then retries and eventually succeeds", async () => {
      let createAttempts = 0
      const client = {
        session: {
          create: async () => {
            createAttempts += 1
            if (createAttempts < 3) {
              throw new Error("temporary failure")
            }
            return { data: { id: "fresh-ses-retry" } }
          },
          promptAsync: async () => {},
          messages: async () => ({ data: [] }),
        },
      }

      setPendingSwitch("ses-4", "atlas", "fix this")
      await applyPendingSwitch({
        sessionID: "ses-4",
        client: client as any,
        source: "idle",
      })

      await new Promise((resolve) => setTimeout(resolve, 800))

      expect(createAttempts).toBe(3)
      expect(getPendingSwitch("ses-4")).toBeUndefined()
    })
  })

  describe("#given session idle wait", () => {
    test("#when session is busy, #then waits for idle before creating fresh session", async () => {
      let statusChecks = 0
      let createCalled = false
      const client = {
        session: {
          status: async () => {
            statusChecks += 1
            return {
              "ses-5": { type: statusChecks < 3 ? "running" : "idle" },
            }
          },
          create: async () => {
            createCalled = true
            return { data: { id: "fresh-ses-idle" } }
          },
          promptAsync: async () => {},
          messages: async () => ({ data: [] }),
        },
      }

      setPendingSwitch("ses-5", "atlas", "fix now")
      await applyPendingSwitch({
        sessionID: "ses-5",
        client: client as any,
        source: "idle",
      })

      expect(statusChecks).toBeGreaterThanOrEqual(3)
      expect(createCalled).toBe(true)
      expect(getPendingSwitch("ses-5")).toBeUndefined()
    })
  })

  describe("#given runtime cancellation", () => {
    test("#when clearPendingSwitchRuntime called, #then cancels pending retries", async () => {
      let attempts = 0
      const client = {
        session: {
          create: async () => {
            attempts += 1
            throw new Error("always failing")
          },
          promptAsync: async () => {},
          messages: async () => ({ data: [] }),
        },
      }

      setPendingSwitch("ses-6", "atlas", "fix this")
      await applyPendingSwitch({
        sessionID: "ses-6",
        client: client as any,
        source: "idle",
      })

      clearPendingSwitchRuntime("ses-6")

      const attemptsAfterClear = attempts

      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(attempts).toBe(attemptsAfterClear)
      expect(getPendingSwitch("ses-6")).toBeUndefined()
    })
  })

  describe("#given create not available on client", () => {
    test("#when session.create is missing, #then enters retry path", async () => {
      const client = {
        session: {
          promptAsync: async () => {},
          messages: async () => ({ data: [] }),
        },
      }

      setPendingSwitch("ses-7", "atlas", "fix now")
      await applyPendingSwitch({
        sessionID: "ses-7",
        client: client as any,
        source: "idle",
      })

      expect(getPendingSwitch("ses-7")).toBeDefined()

      clearPendingSwitchRuntime("ses-7")
      expect(getPendingSwitch("ses-7")).toBeUndefined()
    })
  })
})
