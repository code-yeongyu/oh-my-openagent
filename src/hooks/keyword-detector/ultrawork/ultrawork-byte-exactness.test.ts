/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { getUltraworkMessage, getUltraworkSource } from "./index"
import type { UltraworkSource } from "./source-detector"

type UltraworkPromptBaseline = {
  readonly name: string
  readonly agentName: string
  readonly modelID: string
  readonly expectedSource: UltraworkSource
  readonly sha256: string
}

const ULTRAWORK_PROMPT_BASELINES: readonly UltraworkPromptBaseline[] = [
  {
    name: "default",
    agentName: "sisyphus",
    modelID: "claude-sonnet-4-6",
    expectedSource: "default",
    sha256: "299e7933768697d22396290ed23676db1e030ef31690c8b666424d49c0a0ea2a",
  },
  {
    name: "gpt",
    agentName: "sisyphus",
    modelID: "gpt-5.5",
    expectedSource: "gpt",
    sha256: "c3e0b748ffd633503fcf127d41ddea8322c680011d86c8f827c07cd2b7b040e6",
  },
  {
    name: "gemini",
    agentName: "sisyphus",
    modelID: "gemini-3.1-pro",
    expectedSource: "gemini",
    sha256: "7c1adf9a8d84a08e5a2593e6f9d189307ec2dd5e5f6facecdf34a92883acab33",
  },
  {
    name: "planner",
    agentName: "prometheus",
    modelID: "gpt-5.5",
    expectedSource: "planner",
    sha256: "8897b3a11b61c12a02bfba13a76c80742bc4e5356cfc30e2f0c38464aa587bf3",
  },
]

describe("Ultrawork prompt byte exactness", () => {
  test("#given captured ultrawork prompt baselines #then every routed source keeps the same bytes", () => {
    for (const baseline of ULTRAWORK_PROMPT_BASELINES) {
      const source = getUltraworkSource(baseline.agentName, baseline.modelID)
      const prompt = getUltraworkMessage(baseline.agentName, baseline.modelID)

      expect(source, baseline.name).toBe(baseline.expectedSource)
      expect(prompt.length, baseline.name).toBeGreaterThan(0)
      expect(hashPrompt(prompt), baseline.name).toBe(baseline.sha256)
    }
  })
})

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex")
}
