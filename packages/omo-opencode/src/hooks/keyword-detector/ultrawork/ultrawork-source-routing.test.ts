import { SUPPORTED_MODELS } from "@oh-my-opencode/model-core";
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
    modelID: SUPPORTED_MODELS.CLAUDE_SONNET_4_6,
    expectedSource: "default",
  },
  {
    name: "gpt",
    agentName: "sisyphus",
    modelID: SUPPORTED_MODELS.GPT_5_5,
    expectedSource: "gpt",
  },
  {
    name: "gemini",
    agentName: "sisyphus",
    modelID: SUPPORTED_MODELS.GEMINI_3_1_PRO,
    expectedSource: "gemini",
  },
  {
    name: "glm",
    agentName: "sisyphus",
    modelID: "zai/glm-5.2",
    expectedSource: "glm",
  },
  {
    name: "planner",
    agentName: "prometheus",
    modelID: SUPPORTED_MODELS.GPT_5_5,
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
