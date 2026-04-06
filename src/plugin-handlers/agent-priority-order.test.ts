import { describe, expect, test } from "bun:test"

import { reorderAgentsByPriority } from "./agent-priority-order"
import { getAgentListDisplayName } from "../shared/agent-display-names"

describe("reorderAgentsByPriority", () => {
  test("moves core agents to canonical order and injects runtime order fields", () => {
    // given
    const sisyphus = getAgentListDisplayName("sisyphus")
    const hephaestus = getAgentListDisplayName("hephaestus")
    const prometheus = getAgentListDisplayName("prometheus")
    const atlas = getAgentListDisplayName("atlas")
    const oracle = getAgentListDisplayName("oracle")

    const agents: Record<string, unknown> = {
      [oracle]: { name: "oracle", mode: "subagent" },
      [atlas]: { name: "atlas", mode: "primary" },
      [prometheus]: { name: "prometheus", mode: "all" },
      [hephaestus]: { name: "hephaestus", mode: "primary" },
      [sisyphus]: { name: "sisyphus", mode: "primary" },
    }

    // when
    const result = reorderAgentsByPriority(agents)

    // then
    expect(Object.keys(result)).toEqual([
      sisyphus,
      hephaestus,
      prometheus,
      atlas,
      oracle,
    ])
    expect(result[sisyphus]).toEqual({
      name: "sisyphus",
      mode: "primary",
      order: 1,
    })
    expect(result[hephaestus]).toEqual({
      name: "hephaestus",
      mode: "primary",
      order: 2,
    })
    expect(result[prometheus]).toEqual({
      name: "prometheus",
      mode: "all",
      order: 3,
    })
    expect(result[atlas]).toEqual({
      name: "atlas",
      mode: "primary",
      order: 4,
    })
    expect(result[oracle]).toEqual({
      name: "oracle",
      mode: "subagent",
    })
  })

  test("leaves non-object agent configs untouched while still reordering keys", () => {
    // given
    const sisyphus = getAgentListDisplayName("sisyphus")
    const atlas = getAgentListDisplayName("atlas")

    const agents: Record<string, unknown> = {
      [atlas]: "atlas-config",
      custom: "custom-config",
      [sisyphus]: "sisyphus-config",
    }

    // when
    const result = reorderAgentsByPriority(agents)

    // then
    expect(Object.keys(result)).toEqual([sisyphus, atlas, "custom"])
    expect(result[sisyphus]).toBe("sisyphus-config")
    expect(result[atlas]).toBe("atlas-config")
    expect(result.custom).toBe("custom-config")
  })
})
