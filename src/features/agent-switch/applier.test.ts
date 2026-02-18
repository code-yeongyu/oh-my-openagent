/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"
import { _resetForTesting, getPendingSwitch, setPendingSwitch } from "./state"
import {
  _resetApplierForTesting,
  applyPendingSwitch,
  clearPendingSwitchRuntime,
} from "./applier"
import { schedulePendingSwitchApply } from "./scheduler"

describe("agent-switch applier", () => {
  beforeEach(() => {
    _resetForTesting()
    _resetApplierForTesting()
  })

  test("scheduled apply works without idle event", async () => {
    const calls: string[] = []
    let switched = false
    const client = {
      session: {
        promptAsync: async (input: { body: { agent: string } }) => {
          calls.push(input.body.agent)
          switched = true
        },
        messages: async () => switched
          ? ({ data: [{ info: { role: "user", agent: "Prometheus (Plan Builder)" } }] })
          : ({ data: [] }),
      },
    }

    setPendingSwitch("ses-1", "prometheus", "create plan")
    schedulePendingSwitchApply({
      sessionID: "ses-1",
      client: client as any,
    })

    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(calls).toEqual(["Prometheus (Plan Builder)"])
    expect(getPendingSwitch("ses-1")).toBeUndefined()
  })

  test("normalizes pending agent to canonical prompt display name", async () => {
    const calls: string[] = []
    let switched = false
    const client = {
      session: {
        promptAsync: async (input: { body: { agent: string } }) => {
          calls.push(input.body.agent)
          switched = true
        },
        messages: async () => switched
          ? ({ data: [{ info: { role: "user", agent: "Prometheus (Plan Builder)" } }] })
          : ({ data: [] }),
      },
    }

    setPendingSwitch("ses-2", "Prometheus (Plan Builder)", "create plan")
    await applyPendingSwitch({
      sessionID: "ses-2",
      client: client as any,
      source: "idle",
    })

    expect(calls).toEqual(["Prometheus (Plan Builder)"])
    expect(getPendingSwitch("ses-2")).toBeUndefined()
  })

  test("retries transient failures and eventually clears pending switch", async () => {
    let attempts = 0
    let switched = false
    const client = {
      session: {
        promptAsync: async () => {
          attempts += 1
          if (attempts < 3) {
            throw new Error("temporary failure")
          }
          switched = true
        },
        messages: async () => switched
          ? ({ data: [{ info: { role: "user", agent: "Atlas (Plan Executor)" } }] })
          : ({ data: [] }),
      },
    }

    setPendingSwitch("ses-3", "atlas", "fix this")
    await applyPendingSwitch({
      sessionID: "ses-3",
      client: client as any,
      source: "idle",
    })

    await new Promise((resolve) => setTimeout(resolve, 800))

    expect(attempts).toBe(3)
    expect(getPendingSwitch("ses-3")).toBeUndefined()
  })

  test("waits for session idle before applying switch", async () => {
    let statusChecks = 0
    let promptCalls = 0
    let switched = false
    const client = {
      session: {
        status: async () => {
          statusChecks += 1
          return {
            "ses-5": { type: statusChecks < 3 ? "running" : "idle" },
          }
        },
        promptAsync: async () => {
          promptCalls += 1
          switched = true
        },
        messages: async () => switched
          ? ({ data: [{ info: { role: "user", agent: "Atlas (Plan Executor)" } }] })
          : ({ data: [] }),
      },
    }

    setPendingSwitch("ses-5", "atlas", "fix now")
    await applyPendingSwitch({
      sessionID: "ses-5",
      client: client as any,
      source: "idle",
    })

    expect(statusChecks).toBeGreaterThanOrEqual(3)
    expect(promptCalls).toBe(1)
    expect(getPendingSwitch("ses-5")).toBeUndefined()
  })

  test("clearPendingSwitchRuntime cancels pending retries", async () => {
    let attempts = 0
    const client = {
      session: {
        promptAsync: async () => {
          attempts += 1
          throw new Error("always failing")
        },
        messages: async () => ({ data: [] }),
      },
    }

    setPendingSwitch("ses-4", "atlas", "fix this")
    await applyPendingSwitch({
      sessionID: "ses-4",
      client: client as any,
      source: "idle",
    })

    clearPendingSwitchRuntime("ses-4")

    const attemptsAfterClear = attempts

    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(attempts).toBe(attemptsAfterClear)
    expect(getPendingSwitch("ses-4")).toBeUndefined()
  })

  test("syncs CLI TUI agent selection for athena-to-atlas handoff", async () => {
    const originalClientEnv = process.env["OPENCODE_CLIENT"]
    process.env["OPENCODE_CLIENT"] = "cli"

    try {
      const promptCalls: string[] = []
      const tuiCommands: string[] = []
      let switched = false
      const client = {
        session: {
          promptAsync: async (input: { body: { agent: string } }) => {
            promptCalls.push(input.body.agent)
            switched = true
          },
          messages: async () => switched
            ? ({
                data: [
                  { info: { role: "user", agent: "Athena (Council)" } },
                  { info: { role: "user", agent: "Atlas (Plan Executor)" } },
                ],
              })
            : ({
                data: [{ info: { role: "user", agent: "Athena (Council)" } }],
              }),
        },
        app: {
          agents: async () => ({
            data: [
              { name: "Sisyphus (Ultraworker)", mode: "primary" },
              { name: "Hephaestus (Deep Agent)", mode: "primary" },
              { name: "Prometheus (Plan Builder)", mode: "primary" },
              { name: "Atlas (Plan Executor)", mode: "primary" },
              { name: "Athena (Council)", mode: "primary" },
            ],
          }),
        },
        tui: {
          publish: async (input: { body: { properties: { command: string } } }) => {
            tuiCommands.push(input.body.properties.command)
          },
        },
      }

      setPendingSwitch("ses-6", "atlas", "fix now")
      await applyPendingSwitch({
        sessionID: "ses-6",
        client: client as any,
        source: "message-updated",
      })

      expect(promptCalls).toEqual(["Atlas (Plan Executor)"])
      expect(tuiCommands).toEqual(["agent.cycle.reverse"])
      expect(getPendingSwitch("ses-6")).toBeUndefined()
    } finally {
      if (originalClientEnv === undefined) {
        delete process.env["OPENCODE_CLIENT"]
      } else {
        process.env["OPENCODE_CLIENT"] = originalClientEnv
      }
    }
  })
})
