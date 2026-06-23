import { afterEach, describe, expect, spyOn, test } from "bun:test"

import type { PolicyVerdict } from "../reasoning-core-policy-gate/types"
import * as verdictStore from "./verdict-store"
import { createEpistemicStateInterpreterHook } from "./hook"
import { _resetForTesting as resetAnnotations } from "./annotation-store"
import { _resetForTesting as resetHistory } from "./history-store"

type TestGateMode = "annotation" | "gate" | "hybrid"
type FixtureState = "excluded" | "operationally_excluded" | "open" | "plausible"

function createConfig(gateMode?: TestGateMode) {
  return gateMode
    ? { epistemic_state_interpreter_enabled: true, epistemic_gate_mode: gateMode }
    : { epistemic_state_interpreter_enabled: true }
}

function createProofArtifact(state: FixtureState, conclusion: string) {
  const status = state === "open" ? "Undecided" : state === "plausible" ? "Accepted" : "Rejected"
  const proofChain = state === "operationally_excluded"
    ? [{ conclusion, from: ["support"], rule_id: "d1", rule_kind: "defeasible" }]
    : state === "plausible"
      ? [{ conclusion, from: ["support"], rule_id: "d1", rule_kind: "defeasible" }]
      : [{ conclusion, from: [], rule_id: null, rule_kind: "ordinary" }]

  return {
    theory: {},
    result: {
      semantics: "preferred",
      extensions: [{ index: 0, accepted_conclusions: state === "plausible" ? [conclusion] : [] }],
      conclusions: {
        [conclusion]: {
          conclusion,
          status,
          proof_chain: proofChain,
        },
      },
    },
  }
}

function createVerdict(state: FixtureState, conclusion: string): PolicyVerdict {
  return {
    allow: true,
    proofArtifact: createProofArtifact(state, conclusion),
  }
}

afterEach(() => {
  resetAnnotations()
  resetHistory()
})

describe("createEpistemicStateInterpreterHook gate wiring", () => {
  describe("given annotation mode", () => {
    describe("when the annotation is excluded", () => {
      test("then the tool is not blocked", async () => {
        const verdictSpy = spyOn(verdictStore, "getVerdict").mockReturnValue(createVerdict("excluded", "deny(action)"))
        const hook = createEpistemicStateInterpreterHook(createConfig("annotation"))

        await expect(
          hook["tool.execute.before"]({ tool: "bash", sessionID: "gate-annotation", callID: "c1" }, { args: {} }),
        ).resolves.toBeUndefined()

        verdictSpy.mockRestore()
      })
    })
  })

  describe("given gate mode", () => {
    describe("when the annotation is excluded", () => {
      test("then it throws a descriptive gate error", async () => {
        const verdictSpy = spyOn(verdictStore, "getVerdict").mockReturnValue(createVerdict("excluded", "deny(action)"))
        const hook = createEpistemicStateInterpreterHook(createConfig("gate"))

        await expect(
          hook["tool.execute.before"]({ tool: "bash", sessionID: "gate-excluded", callID: "c1" }, { args: {} }),
        ).rejects.toThrow("[epistemic gate] gate mode: conclusion 'deny(action)' blocked (state=excluded, below 'open')")

        verdictSpy.mockRestore()
      })
    })

    describe("when the annotation is open", () => {
      test("then it does not throw", async () => {
        const verdictSpy = spyOn(verdictStore, "getVerdict").mockReturnValue(createVerdict("open", "investigate(action)"))
        const hook = createEpistemicStateInterpreterHook(createConfig("gate"))

        await expect(
          hook["tool.execute.before"]({ tool: "bash", sessionID: "gate-open", callID: "c1" }, { args: {} }),
        ).resolves.toBeUndefined()

        verdictSpy.mockRestore()
      })
    })
  })

  describe("given hybrid mode", () => {
    describe("when the annotation is operationally excluded", () => {
      test("then it throws", async () => {
        const verdictSpy = spyOn(verdictStore, "getVerdict").mockReturnValue(
          createVerdict("operationally_excluded", "risk(action)"),
        )
        const hook = createEpistemicStateInterpreterHook(createConfig("hybrid"))

        await expect(
          hook["tool.execute.before"]({ tool: "bash", sessionID: "hybrid-blocked", callID: "c1" }, { args: {} }),
        ).rejects.toThrow("[epistemic gate] hybrid mode: conclusion 'risk(action)' blocked (state=operationally_excluded)")

        verdictSpy.mockRestore()
      })
    })

    describe("when the annotation is plausible", () => {
      test("then it does not throw", async () => {
        const verdictSpy = spyOn(verdictStore, "getVerdict").mockReturnValue(createVerdict("plausible", "support(action)"))
        const hook = createEpistemicStateInterpreterHook(createConfig("hybrid"))

        await expect(
          hook["tool.execute.before"]({ tool: "bash", sessionID: "hybrid-allowed", callID: "c1" }, { args: {} }),
        ).resolves.toBeUndefined()

        verdictSpy.mockRestore()
      })
    })
  })

  describe("given missing gate mode config", () => {
    describe("when the annotation is excluded", () => {
      test("then it defaults to annotation mode without blocking", async () => {
        const verdictSpy = spyOn(verdictStore, "getVerdict").mockReturnValue(createVerdict("excluded", "default(action)"))
        const hook = createEpistemicStateInterpreterHook(createConfig())

        await expect(
          hook["tool.execute.before"]({ tool: "bash", sessionID: "default-annotation", callID: "c1" }, { args: {} }),
        ).resolves.toBeUndefined()

        verdictSpy.mockRestore()
      })
    })
  })
})
