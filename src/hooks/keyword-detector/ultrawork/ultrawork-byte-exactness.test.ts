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
    sha256: "78aa43e2e2b7db307827d9ddda30a4c6a24aa35a9255efe1ee39a4476d71acca",
  },
  {
    name: "gpt",
    agentName: "sisyphus",
    modelID: "gpt-5.5",
    expectedSource: "gpt",
    sha256: "8f31f0053256914e94605944b28e123c584a0ad093e0d44d5ad66da009a632ae",
  },
  {
    name: "gemini",
    agentName: "sisyphus",
    modelID: "gemini-3.1-pro",
    expectedSource: "gemini",
    sha256: "5c5766549e868e7a1c87252e742e491b7015138948c6e26fb704346bb55d5d7c",
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
