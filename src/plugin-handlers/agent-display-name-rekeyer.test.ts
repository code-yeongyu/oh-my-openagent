/// <reference types="bun-types" />

import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test"
import { rekeyAgentsByDisplayNames } from "./agent-display-name-rekeyer"
import * as aliasModule from "../shared/agent-name-aliases"
import * as shared from "../shared"

beforeEach(() => {
  aliasModule.resetAgentNameAliases()
  spyOn(shared, "log" as any).mockImplementation(() => {})
})

afterEach(() => {
  aliasModule.resetAgentNameAliases()
  ;(shared.log as any)?.mockRestore?.()
})

describe("rekeyAgentsByDisplayNames", () => {
  test("basic re-keying: sisyphus -> Bob", () => {
    //#given
    const config: Record<string, unknown> = {
      agent: {
        sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
      },
    }
    const agentResult: Record<string, unknown> = {
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
    }
    const displayNames = { sisyphus: "Bob" }

    //#when
    rekeyAgentsByDisplayNames({ config, agentResult, displayNames })

    //#then
    const agent = config.agent as Record<string, unknown>
    expect(agent["Bob"]).toBeDefined()
    expect(agent["sisyphus"]).toBeUndefined()
    expect(agentResult["Bob"]).toBeDefined()
    expect(agentResult["sisyphus"]).toBeUndefined()
  })

  test("default_agent is re-keyed: sisyphus -> Bob", () => {
    //#given
    const config: Record<string, unknown> = {
      default_agent: "sisyphus",
      agent: {
        sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
      },
    }
    const agentResult: Record<string, unknown> = {
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
    }
    const displayNames = { sisyphus: "Bob" }

    //#when
    rekeyAgentsByDisplayNames({ config, agentResult, displayNames })

    //#then
    expect(config.default_agent).toBe("Bob")
  })

  test("no-op when displayNames is undefined", () => {
    //#given
    const config: Record<string, unknown> = {
      agent: {
        sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
      },
    }
    const agentResult: Record<string, unknown> = {
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
    }

    //#when
    rekeyAgentsByDisplayNames({ config, agentResult, displayNames: undefined })

    //#then
    const agent = config.agent as Record<string, unknown>
    expect(agent["sisyphus"]).toBeDefined()
    expect(agentResult["sisyphus"]).toBeDefined()
  })

  test("no-op when displayNames is empty {}", () => {
    //#given
    const config: Record<string, unknown> = {
      agent: {
        sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
      },
    }
    const agentResult: Record<string, unknown> = {
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
    }

    //#when
    rekeyAgentsByDisplayNames({ config, agentResult, displayNames: {} })

    //#then
    const agent = config.agent as Record<string, unknown>
    expect(agent["sisyphus"]).toBeDefined()
    expect(agentResult["sisyphus"]).toBeDefined()
  })

  test("multiple re-keys: sisyphus -> Bob, oracle -> Advisor", () => {
    //#given
    const config: Record<string, unknown> = {
      agent: {
        sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
        oracle: { name: "oracle", prompt: "test", mode: "subagent" },
      },
    }
    const agentResult: Record<string, unknown> = {
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
      oracle: { name: "oracle", prompt: "test", mode: "subagent" },
    }
    const displayNames = { sisyphus: "Bob", oracle: "Advisor" }

    //#when
    rekeyAgentsByDisplayNames({ config, agentResult, displayNames })

    //#then
    const agent = config.agent as Record<string, unknown>
    expect(agent["Bob"]).toBeDefined()
    expect(agent["sisyphus"]).toBeUndefined()
    expect(agent["Advisor"]).toBeDefined()
    expect(agent["oracle"]).toBeUndefined()
    expect(agentResult["Bob"]).toBeDefined()
    expect(agentResult["Advisor"]).toBeDefined()
  })

  test("non-existent agent in displayNames: warning logged, no crash", () => {
    //#given
    const config: Record<string, unknown> = {
      agent: {
        sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
      },
    }
    const agentResult: Record<string, unknown> = {
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
    }
    const displayNames = { nonexistent: "Ghost" }
    const logSpy = shared.log as ReturnType<typeof spyOn>

    //#when
    rekeyAgentsByDisplayNames({ config, agentResult, displayNames })

    //#then - should not crash, should log warning
    const agent = config.agent as Record<string, unknown>
    expect(agent["sisyphus"]).toBeDefined()
    expect(agent["Ghost"]).toBeUndefined()
    const logCalls = logSpy.mock.calls.map((c: unknown[]) => c[0])
    const hasWarning = logCalls.some(
      (msg: string) => typeof msg === "string" && msg.includes("nonexistent")
    )
    expect(hasWarning).toBe(true)
  })

  test("unchanged agents remain: agents not in displayNames keep canonical keys", () => {
    //#given
    const config: Record<string, unknown> = {
      agent: {
        sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
        oracle: { name: "oracle", prompt: "test", mode: "subagent" },
        librarian: { name: "librarian", prompt: "test", mode: "subagent" },
      },
    }
    const agentResult: Record<string, unknown> = {
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
      oracle: { name: "oracle", prompt: "test", mode: "subagent" },
      librarian: { name: "librarian", prompt: "test", mode: "subagent" },
    }
    const displayNames = { sisyphus: "Bob" }

    //#when
    rekeyAgentsByDisplayNames({ config, agentResult, displayNames })

    //#then
    const agent = config.agent as Record<string, unknown>
    expect(agent["Bob"]).toBeDefined()
    expect(agent["sisyphus"]).toBeUndefined()
    expect(agent["oracle"]).toBeDefined()
    expect(agent["librarian"]).toBeDefined()
    expect(agentResult["oracle"]).toBeDefined()
    expect(agentResult["librarian"]).toBeDefined()
  })

  test("agentResult is also re-keyed in sync with config.agent", () => {
    //#given
    const sisyphusData = { name: "sisyphus", prompt: "test", mode: "primary", permission: { task: "allow" } }
    const config: Record<string, unknown> = {
      agent: { sisyphus: { ...sisyphusData } },
    }
    const agentResult: Record<string, unknown> = {
      sisyphus: { ...sisyphusData },
    }
    const displayNames = { sisyphus: "Bob" }

    //#when
    rekeyAgentsByDisplayNames({ config, agentResult, displayNames })

    //#then
    expect(agentResult["Bob"]).toBeDefined()
    expect(agentResult["sisyphus"]).toBeUndefined()
    const rekeyed = agentResult["Bob"] as Record<string, unknown>
    expect(rekeyed.permission).toEqual({ task: "allow" })
  })

  test("does not create entries in config.agent when canonical key missing from config", () => {
    //#given - agentResult has sisyphus but config.agent does not
    const config: Record<string, unknown> = {
      agent: {},
    }
    const agentResult: Record<string, unknown> = {
      sisyphus: { name: "sisyphus", prompt: "test", mode: "primary" },
    }
    const displayNames = { sisyphus: "Bob" }

    //#when
    rekeyAgentsByDisplayNames({ config, agentResult, displayNames })

    //#then - agentResult re-keyed, config.agent untouched (no creation)
    expect(agentResult["Bob"]).toBeDefined()
    expect(agentResult["sisyphus"]).toBeUndefined()
    const agent = config.agent as Record<string, unknown>
    expect(agent["Bob"]).toBeUndefined()
    expect(Object.keys(agent)).toHaveLength(0)
  })
})
