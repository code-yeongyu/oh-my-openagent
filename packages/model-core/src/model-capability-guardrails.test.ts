import { describe, expect, test } from "bun:test"

import type { ModelCapabilitiesSnapshot } from "./model-capabilities"
import { getBundledModelCapabilitiesSnapshot } from "./model-capabilities"
import bundledModelCapabilitiesSnapshotJson from "../../../packages/omo-opencode/src/generated/model-capabilities.generated.json"
import {
  collectModelCapabilityGuardrailIssues,
  getBuiltInRequirementModelIDs,
} from "./model-capability-guardrails"

describe("model-capability-guardrails", () => {
  test("keeps the current alias registry and built-in requirements aligned with the bundled snapshot", () => {
    const issues = collectModelCapabilityGuardrailIssues({
      snapshot: getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson),
    })

    expect(issues).toEqual([])
  })

  test("requires built-in requirement models to stay unique and sorted", () => {
    const modelIDs = getBuiltInRequirementModelIDs()

    expect(modelIDs).toEqual([...modelIDs].sort())
    expect(new Set(modelIDs).size).toBe(modelIDs.length)
    expect(modelIDs).toContain("claude-opus-4-8")
    expect(modelIDs).toContain("gpt-5.5")
    expect(modelIDs).toContain("kimi-k2.5")
  })

  test("flags exact aliases whose canonical target disappears from the snapshot", () => {
    const bundledSnapshot = getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson)
    const brokenSnapshot: ModelCapabilitiesSnapshot = {
      ...bundledSnapshot,
      models: Object.fromEntries(
        Object.entries(bundledSnapshot.models).filter(([modelID]) => modelID !== "gemini-3-pro-preview"),
      ),
    }

    const issues = collectModelCapabilityGuardrailIssues({
      snapshot: brokenSnapshot,
      requirementModelIDs: [],
    })

    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: "alias-target-missing-from-snapshot",
        aliasModelID: "gemini-3-pro-high",
        canonicalModelID: "gemini-3-pro-preview",
      }),
    )
  })

  test("flags pattern aliases when models.dev gains a canonical entry for the alias itself", () => {
    const bundledSnapshot = getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson)
    const aliasCollisionSnapshot: ModelCapabilitiesSnapshot = {
      ...bundledSnapshot,
      models: {
        ...bundledSnapshot.models,
        "gemini-3.1-pro-high": {
          id: "gemini-3.1-pro-high",
          family: "gemini",
          reasoning: true,
        },
      },
    }

    const issues = collectModelCapabilityGuardrailIssues({
      snapshot: aliasCollisionSnapshot,
      requirementModelIDs: [],
    })

    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: "pattern-alias-collides-with-snapshot",
        modelID: "gemini-3.1-pro-high",
        canonicalModelID: "gemini-3.1-pro",
      }),
    )
  })

  test("flags exact aliases when models.dev gains a canonical entry for the alias itself", () => {
    const bundledSnapshot = getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson)
    const aliasCollisionSnapshot: ModelCapabilitiesSnapshot = {
      ...bundledSnapshot,
      models: {
        ...bundledSnapshot.models,
        "gemini-3-pro-high": {
          id: "gemini-3-pro-high",
          family: "gemini",
          reasoning: true,
        },
      },
    }

    const issues = collectModelCapabilityGuardrailIssues({
      snapshot: aliasCollisionSnapshot,
      requirementModelIDs: [],
    })

    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: "exact-alias-collides-with-snapshot",
        aliasModelID: "gemini-3-pro-high",
        canonicalModelID: "gemini-3-pro-preview",
      }),
    )
  })

  test("flags built-in requirement models that rely on aliases instead of canonical IDs", () => {
    const issues = collectModelCapabilityGuardrailIssues({
      snapshot: getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson),
      requirementModelIDs: ["gemini-3.1-pro-high"],
    })

    expect(issues).toContainEqual(
      expect.objectContaining({
        kind: "built-in-model-relies-on-alias",
        modelID: "gemini-3.1-pro-high",
        canonicalModelID: "gemini-3.1-pro",
        ruleID: "gemini-3.1-pro-tier-alias",
      }),
    )
  })
})
