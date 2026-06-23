/// <reference path="../../../bun-test.d.ts" />

import * as loggerModule from "../../shared/logger"
import * as proofArtifactParserModule from "../../hooks/epistemic-state-interpreter/proof-artifact-parser"
import { _resetHookStoreForTesting } from "../../hooks/epistemic-state-interpreter/hook-store"
import {
  _resetMultiPlaneStoreForTesting,
  getMultiPlaneAnnotations,
  getSessionHooks,
} from "../../hooks/epistemic-state-interpreter/annotation-store-v2"
import type { MultiPlaneHookConfig } from "../../hooks/epistemic-state-interpreter/hook-v2"
import { runEpistemicPipeline } from "./epistemic-pipeline"

const { afterEach, describe, expect, it, spyOn } = require("bun:test")

const CONFIG: MultiPlaneHookConfig = {
  enabled: true,
  epistemic_gate_mode: "hybrid",
  plausibilita_threshold: 0.6,
  ethical_value_hierarchy: ["vita_umana", "autonomia"],
  pragmatic_weights: { peso_proprio: 0.6, peso_controparte: 0.4 },
  moral_context_defaults: {
    default_audience: "general",
    require_audience_model: false,
  },
  transition_thresholds: {
    advancement_min_strength: 1,
    retrocession_min_strength: 2,
    expulsion_min_strength: 3,
    reopening_min_strength: 2,
  },
  confidence_weights: {
    extensionRatio: 0.4,
    proofChainDepth: 0.3,
    ruleStrength: 0.3,
  },
}

function buildConclusion(status: string, ruleKind: "strict" | "defeasible") {
  return {
    conclusion: "",
    status,
    proof_chain: [
      {
        conclusion: "support",
        from: [],
        rule_id: ruleKind === "strict" ? "s1" : "d1",
        rule_kind: ruleKind,
      },
    ],
  }
}

function buildProofArtifact() {
  return {
    theory: {},
    result: {
      semantics: "preferred",
      extensions: [
        { index: 0, accepted_conclusions: ["accept(alpha)"] },
        { index: 1, accepted_conclusions: ["accept(alpha)"] },
      ],
      conclusions: {
        "accept(alpha)": {
          ...buildConclusion("Accepted", "strict"),
          conclusion: "accept(alpha)",
        },
        "reject(beta)": {
          ...buildConclusion("Rejected", "defeasible"),
          conclusion: "reject(beta)",
        },
      },
    },
  }
}

afterEach(() => {
  _resetMultiPlaneStoreForTesting()
  _resetHookStoreForTesting()
})

describe("runEpistemicPipeline", () => {
  it("stores annotations and hooks, computes piano D, and logs blocked conclusions", () => {
    const logSpy = spyOn(loggerModule, "log")

    expect(() => runEpistemicPipeline(buildProofArtifact(), "ses-1", "call-1", CONFIG)).not.toThrow()

    const annotations = getMultiPlaneAnnotations("ses-1")
    const hooks = getSessionHooks("ses-1")

    expect(annotations).toHaveLength(2)
    expect(hooks).toHaveLength(2)
    expect(annotations.every((annotation) => annotation.state.pianoD !== null)).toBe(true)
    expect(
      logSpy.mock.calls.some(
        ([message, data]) =>
          message === "[epistemic-v2] gate blocked - continuing"
          && typeof data === "object"
          && data !== null
          && "conclusion" in data
          && data.conclusion === "reject(beta)",
      ),
    ).toBe(true)
    expect(
      logSpy.mock.calls.filter(
        ([message, data]) =>
          message === "[epistemic-v2] annotation updated"
          && typeof data === "object"
          && data !== null
          && "sessionID" in data
          && data.sessionID === "ses-1"
          && "callID" in data
          && data.callID === "call-1",
      ).length,
    ).toBe(2)
    expect(
      logSpy.mock.calls.some(
        ([message, data]) =>
          message === "[epistemic-v2] annotation updated"
          && typeof data === "object"
          && data !== null
          && "plausibile" in data
          && data.plausibile === true
          && "pianoD" in data
          && typeof data.pianoD === "boolean",
      ),
    ).toBe(true)
    const valutazioneLogs = logSpy.mock.calls.filter(
      ([message]) => message === "[epistemic-v2] valutazione",
    )
    expect(valutazioneLogs.length).toBeGreaterThan(0)
    const [, valData] = valutazioneLogs[0]
    expect(valData).toHaveProperty("eticoLabel")
    expect(valData).toHaveProperty("pragmaticoLabel")
    expect(valData).toHaveProperty("moraleLabel")
    expect(valData).toHaveProperty("combined")
    expect(typeof valData.combined).toBe("number")

    logSpy.mockRestore()
  })

  it("logs and swallows internal pipeline failures", () => {
    const logSpy = spyOn(loggerModule, "log")
    const parserSpy = spyOn(proofArtifactParserModule, "parseProofArtifact").mockImplementation(() => {
      throw new Error("boom")
    })

    expect(() => runEpistemicPipeline(buildProofArtifact(), "ses-1", "call-1", CONFIG)).not.toThrow()
    expect(
      logSpy.mock.calls.some(
        ([message, data]) =>
          message === "[epistemic-v2] pipeline failed - continuing"
          && typeof data === "object"
          && data !== null
          && "error" in data
          && data.error === "Error: boom",
      ),
    ).toBe(true)

    parserSpy.mockRestore()
    logSpy.mockRestore()
  })
})
