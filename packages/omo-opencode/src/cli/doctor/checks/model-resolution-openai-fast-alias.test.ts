import { describe, expect, test } from "bun:test"

import { buildModelResolutionDetails } from "./model-resolution-details"
import { collectCapabilityResolutionIssues, getModelResolutionInfoWithOverrides } from "./model-resolution"
import type { OmoConfig } from "./model-resolution-types"

describe("doctor OpenAI GPT-5.6 fast capability diagnostics", () => {
  test("preserves the configured model and variant while reporting alias-backed capabilities", () => {
    const config: OmoConfig = {
      agents: {
        hephaestus: { model: "openai/gpt-5.6-sol-fast", variant: "xhigh" },
      },
    }
    const info = getModelResolutionInfoWithOverrides(config)
    const hephaestus = info.agents.find((agent) => agent.name === "hephaestus")
    const details = buildModelResolutionDetails({
      info,
      available: { providers: ["openai"], modelCount: 1, cacheExists: true },
      config,
    })
    const hephaestusDetail = details.find((detail) => detail.includes("hephaestus:"))

    expect(hephaestus).toMatchObject({
      effectiveModel: "openai/gpt-5.6-sol-fast",
      userVariant: "xhigh",
      capabilityDiagnostics: {
        resolutionMode: "alias-backed",
        canonicalization: {
          source: "pattern-alias",
          ruleID: "openai-gpt-5.6-fast-service-tier-alias",
        },
      },
    })
    expect(hephaestusDetail).toContain("openai/gpt-5.6-sol-fast (xhigh)")
    expect(hephaestusDetail).toContain("capabilities: alias-backed")
    expect(hephaestusDetail).not.toContain("heuristic-backed")
    expect(collectCapabilityResolutionIssues(info)).toEqual([])
  })
})
