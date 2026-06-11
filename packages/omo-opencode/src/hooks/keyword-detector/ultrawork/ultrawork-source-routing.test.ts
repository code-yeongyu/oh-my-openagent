/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { getUltraworkSource } from "./index"
import type { UltraworkSource } from "./source-detector"

type UltraworkRoutingBaseline = {
  readonly name: string
  readonly agentName: string
  readonly modelID: string
  readonly expectedSource: UltraworkSource
}

const ULTRAWORK_ROUTING_BASELINES: readonly UltraworkRoutingBaseline[] = [
  {
    name: "default",
    agentName: "sisyphus",
    modelID: "claude-sonnet-4-6",
    expectedSource: "default",
  },
  {
    name: "gpt",
    agentName: "sisyphus",
    modelID: "gpt-5.5",
    expectedSource: "gpt",
  },
  {
    name: "gemini",
    agentName: "sisyphus",
    modelID: "gemini-3.1-pro",
    expectedSource: "gemini",
  },
  {
    name: "planner",
    agentName: "prometheus",
    modelID: "gpt-5.5",
    expectedSource: "planner",
  },
]

describe("Ultrawork source routing", () => {
  test("#given agent and model #then getUltraworkSource routes to the expected variant", () => {
    for (const baseline of ULTRAWORK_ROUTING_BASELINES) {
      const source = getUltraworkSource(baseline.agentName, baseline.modelID)

      expect(source, baseline.name).toBe(baseline.expectedSource)
    }
  })
})
