import { describe, expect, test } from "bun:test"

import { buildModelResolutionDetails } from "./model-resolution-details"
import { collectCapabilityResolutionIssues, getModelResolutionInfoWithOverrides } from "./model-resolution"
import type { OmoConfig } from "./model-resolution-types"

describe("doctor kimi-for-coding K3 capability diagnostics", () => {
  test("reports the configured k3 model as snapshot-backed without warnings", () => {
    const config: OmoConfig = {
      agents: {
        sisyphus: { model: "kimi-for-coding/k3" },
      },
    }
    const info = getModelResolutionInfoWithOverrides(config)
    const sisyphus = info.agents.find((agent) => agent.name === "sisyphus")
    const details = buildModelResolutionDetails({
      info,
      available: { providers: ["kimi-for-coding"], modelCount: 3, cacheExists: true },
      config,
    })
    const sisyphusDetail = details.find((detail) => detail.includes("sisyphus:"))

    expect(sisyphus).toMatchObject({
      effectiveModel: "kimi-for-coding/k3",
      capabilityDiagnostics: {
        resolutionMode: "snapshot-backed",
        snapshot: { source: "bundled-snapshot" },
      },
    })
    expect(sisyphusDetail).toContain("kimi-for-coding/k3")
    expect(sisyphusDetail).toContain("capabilities: snapshot-backed")
    expect(sisyphusDetail).not.toContain("unknown")
    expect(collectCapabilityResolutionIssues(info)).toEqual([])
  })
})
