import { describe, expect, it, mock } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { resolveRunnableRunAgent, type RunAgentListClient } from "./runnable-agent-resolver"

function createClient(agentNames: readonly string[]): RunAgentListClient {
  return unsafeTestValue<RunAgentListClient>({
    app: {
      agents: mock(() =>
        Promise.resolve({
          data: agentNames.map((name) => ({ name })),
        })
      ),
    },
  })
}

describe("resolveRunnableRunAgent", () => {
  it("#given server exposes Sisyphus by display name #when run agent is config key #then returns registered display name", async () => {
    // given
    const client = createClient(["Sisyphus - ultraworker", "general"])

    // when
    const agent = await resolveRunnableRunAgent(client, "sisyphus")

    // then
    expect(agent).toBe("Sisyphus - ultraworker")
  })

  it("#given requested custom agent exists exactly #when resolving runnable agent #then preserves custom name", async () => {
    // given
    const client = createClient(["custom-agent", "Sisyphus - ultraworker"])

    // when
    const agent = await resolveRunnableRunAgent(client, "custom-agent")

    // then
    expect(agent).toBe("custom-agent")
  })

  it("#given known display-name input #when resolving runnable agent #then returns server registered casing", async () => {
    // given
    const client = createClient(["Sisyphus - ultraworker"])

    // when
    const agent = await resolveRunnableRunAgent(client, "Sisyphus - Ultraworker")

    // then
    expect(agent).toBe("Sisyphus - ultraworker")
  })

  it("#given built-in agent has configured display name #when resolving config key #then returns configured server name", async () => {
    // given
    const client = createClient(["总指挥"])

    // when
    const agent = await resolveRunnableRunAgent(client, "sisyphus", {
      agents: {
        sisyphus: {
          displayName: "总指挥",
        },
      },
    })

    // then
    expect(agent).toBe("总指挥")
  })

  it("#given agent list lookup fails with Error #when resolving runnable agent #then preserves pre-resolved run agent", async () => {
    // given
    const client = unsafeTestValue<RunAgentListClient>({
      app: {
        agents: mock(() => Promise.reject(new Error("server unavailable"))),
      },
    })

    // when
    const agent = await resolveRunnableRunAgent(client, "sisyphus")

    // then
    expect(agent).toBe("sisyphus")
  })
})
