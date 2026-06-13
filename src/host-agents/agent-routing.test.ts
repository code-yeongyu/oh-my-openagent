import { describe, expect, test } from "bun:test"
import { createTargetAgentInventory, TARGET_AGENT_NAMES } from "./agent-inventory"
import { createTargetCategoryInventory } from "./category-inventory"
import { resolveTargetAgentRoute } from "./agent-routing"

describe("target agent inventory", () => {
  test("#given target agent inventory #when listed #then all named agents preserve canonical core order", () => {
    const agents = createTargetAgentInventory()
    expect(agents.map((agent) => agent.name)).toEqual([...TARGET_AGENT_NAMES])
    expect(agents.slice(0, 4).map((agent) => agent.name)).toEqual(["sisyphus", "hephaestus", "prometheus", "atlas"])
  })

  test("#given restricted agents #when inventory is built #then read-only and Prometheus policies are preserved", () => {
    const agents = createTargetAgentInventory()
    expect(agents.find((agent) => agent.name === "oracle")?.policy).toBe("read-only")
    expect(agents.find((agent) => agent.name === "prometheus")?.policy).toBe("prometheus-markdown-only")
    expect(agents.find((agent) => agent.name === "prometheus")?.tools).toEqual(["read", "grep", "find", "ls", "write", "edit"])
  })

  test("#given agent and category routes #when resolved #then core read-only restricted and category paths route", () => {
    const core = resolveTargetAgentRoute("pi", { subagentType: "sisyphus", prompt: "implement" })
    const readOnly = resolveTargetAgentRoute("pi", { subagentType: "oracle", prompt: "review" })
    const restricted = resolveTargetAgentRoute("oh-my-pi", { subagentType: "prometheus", prompt: "plan" })
    const planAlias = resolveTargetAgentRoute("pi", { subagentType: "plan", prompt: "formalize" })
    const category = resolveTargetAgentRoute("oh-my-pi", { category: "quick", prompt: "fix typo" })

    expect(core.agent.policy).toBe("full")
    expect(readOnly.agent.policy).toBe("read-only")
    expect(restricted.agent.policy).toBe("prometheus-markdown-only")
    expect(planAlias.agent.name).toBe("prometheus")
    expect(category.agent.name).toBe("sisyphus-junior")
    expect(category.prompt).toContain("fix typo")
    expect(createTargetCategoryInventory().length).toBeGreaterThan(0)
  })
})
