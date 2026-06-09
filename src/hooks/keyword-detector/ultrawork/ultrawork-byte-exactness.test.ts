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
    sha256: "4485ef94d3b4b0835b20e42f2874e12b886a0dbed7256c0a2ce37d5e35aa6692",
  },
  {
    name: "gpt",
    agentName: "sisyphus",
    modelID: "gpt-5.5",
    expectedSource: "gpt",
    sha256: "c3a2e5892fc537c560459062ca982930d0ceb98652a76c8c447cad86e882c3b7",
  },
  {
    name: "gemini",
    agentName: "sisyphus",
    modelID: "gemini-3.1-pro",
    expectedSource: "gemini",
    sha256: "16c26365148818a38009fa4e8acbd13172a26ddb84c276cff5e671b10da24511",
  },
  {
    name: "planner",
    agentName: "prometheus",
    modelID: "gpt-5.5",
    expectedSource: "planner",
    sha256: "bdb4573634cde51b7c593cdc4a6c8dcf37d405a9963d77a24bf8dd88bbfe93d7",
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
