import { describe, expect, test } from "bun:test"
import { toV2AgentInfo, toV2ModelRef, toV2Permissions } from "./agent-bridge"

describe("toV2ModelRef", () => {
  test("#given a provider/model string #when parsed #then it splits into id and providerID", () => {
    // given
    const model = "openai/gpt-5.6"
    // when
    const ref = toV2ModelRef(model)
    // then
    expect(ref).toEqual({ id: "gpt-5.6", providerID: "openai" })
  })

  test("#given a model with variant #when parsed #then variant is separated", () => {
    // given
    const model = "anthropic/claude-opus-4-8#high"
    // when
    const ref = toV2ModelRef(model)
    // then
    expect(ref).toEqual({ id: "claude-opus-4-8", providerID: "anthropic", variant: "high" })
  })

  test("#given a bare model without provider #when parsed #then it returns undefined", () => {
    // given
    const model = "gpt-5.6"
    // when
    const ref = toV2ModelRef(model)
    // then
    expect(ref).toBeUndefined()
  })
})

describe("toV2Permissions", () => {
  test("#given a V1 tools record #when converted #then allow/deny become V2 permission rules", () => {
    // given
    const agent = { tools: { edit: true, write: false, bash: "ask" } }
    // when
    const permissions = toV2Permissions(agent)
    // then
    expect(permissions).toContainEqual({ action: "tool", resource: "edit", effect: "allow" })
    expect(permissions).toContainEqual({ action: "tool", resource: "write", effect: "deny" })
    expect(permissions).toContainEqual({ action: "tool", resource: "bash", effect: "ask" })
  })

  test("#given a V1 permission map #when converted #then patterns become resources", () => {
    // given
    const agent = { permission: { bash: { "git push *": "ask" }, edit: "allow" } }
    // when
    const permissions = toV2Permissions(agent)
    // then
    expect(permissions).toContainEqual({ action: "bash", resource: "git push *", effect: "ask" })
    expect(permissions).toContainEqual({ action: "edit", resource: "*", effect: "allow" })
  })
})

describe("toV2AgentInfo", () => {
  test("#given a V1 AgentConfig #when converted #then prompt becomes system and temperature lands in request.settings", () => {
    // given
    const agent = {
      prompt: "You are Sisyphus.",
      description: "Main agent",
      mode: "primary",
      model: "openai/gpt-5.6",
      temperature: 0.7,
      hidden: false,
    }
    // when
    const info = toV2AgentInfo("sisyphus", agent)
    // then
    expect(info.system).toBe("You are Sisyphus.")
    expect(info.description).toBe("Main agent")
    expect(info.mode).toBe("primary")
    expect(info.model).toEqual({ id: "gpt-5.6", providerID: "openai" })
    expect(info.request?.settings?.["temperature"]).toBe(0.7)
  })

  test("#given an unknown mode #when converted #then it defaults to subagent", () => {
    // given
    const agent = { mode: "weird" }
    // when
    const info = toV2AgentInfo("odd", agent)
    // then
    expect(info.mode).toBe("subagent")
  })
})
