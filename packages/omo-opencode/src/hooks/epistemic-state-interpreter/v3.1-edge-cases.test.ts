import { afterEach, describe, expect, test } from "bun:test"

import { PreferenceWeightsSchema } from "../../config/schema/epistemic-gate"
import { _resetForTesting as resetAnnotations, storeAnnotations } from "./annotation-store"
import { createPreferenceInjectionHook } from "./preference-injection-hook"
import { clearPreferences } from "./preference-store"
import { evaluateProbabilistico } from "./preference-evaluator-probabilistico"
import { _resetForTesting as resetHistory } from "./history-store"
import { _resetForTesting as resetVerdictStore, storeVerdict } from "./verdict-store"
import { createEpistemicStateInterpreterHook } from "./hook"
import type { EpistemicAnnotation } from "./types"

const SESSION_IDS = [
  "v3.1-edge-e1",
  "v3.1-edge-e2",
  "v3.1-edge-e3",
  "v3.1-edge-e7",
]

const PREFERENCE_CONFIG = {
  preference_weights: {
    logico: 0.6,
    probabilistico: 0.4,
  },
}

function createAnnotation(
  conclusion: string,
  proofChainKind: EpistemicAnnotation["proofChainKind"],
  state: EpistemicAnnotation["state"] = "accepted",
): EpistemicAnnotation {
  return {
    conclusion,
    state,
    rawClassification: state,
    reason: `${conclusion}-reason`,
    timestamp: 1,
    callID: "call-1",
    proofChainKind,
    extensionMembership: { inCount: 1, totalCount: 1 },
  }
}

function createProofArtifact(conclusion: string) {
  return {
    theory: {},
    result: {
      semantics: "preferred",
      extensions: [{ index: 0, accepted_conclusions: [conclusion] }],
      conclusions: {
        [conclusion]: {
          conclusion,
          status: "Accepted",
          proof_chain: [
            { conclusion, from: [], rule_id: "s1", rule_kind: "strict" as const },
          ],
        },
      },
    },
  }
}

afterEach(() => {
  for (const sessionID of SESSION_IDS) {
    clearPreferences(sessionID)
  }
  resetAnnotations()
  resetHistory()
  resetVerdictStore()
})

describe("epistemic-state-interpreter v3.1 edge cases", () => {
  describe("#given no previous preferences", () => {
    test("#when injection runs #then the theory preferences remain unchanged", async () => {
      const sessionID = "v3.1-edge-e1"
      const hook = createPreferenceInjectionHook(PREFERENCE_CONFIG)
      const output = { args: { theory: { preferences: [{ superior: "a", inferior: "b" }] } } }

      await hook["tool.execute.before"]({
        tool: "reason_argue",
        sessionID,
        callID: "call-1",
      }, output)

      expect(output.args.theory.preferences).toEqual([{ superior: "a", inferior: "b" }])
    })
  })

  describe("#given all accepted strict annotations", () => {
    test("#when gate mode is gate #then execution is allowed", () => {
      const sessionID = "v3.1-edge-e2"
      const hook = createEpistemicStateInterpreterHook({
        epistemic_state_interpreter_enabled: true,
        epistemic_gate_mode: "gate",
      })

      storeVerdict(`${sessionID}:call-1`, {
        allow: true,
        proofArtifact: createProofArtifact("support(action)"),
      })

      return expect(
        hook["tool.execute.before"]({
          tool: "bash",
          sessionID,
          callID: "call-1",
        }, { args: {} }),
      ).resolves.toBeUndefined()
    })
  })

  describe("#given an empty theory payload", () => {
    test("#when preference injection runs #then it does not crash", () => {
      const sessionID = "v3.1-edge-e3"
      const hook = createPreferenceInjectionHook(PREFERENCE_CONFIG)

      storeAnnotations(sessionID, [
        createAnnotation("strict-win", "strict"),
        createAnnotation("defeasible-loss", "defeasible", "open"),
      ])

      return expect(
        hook["tool.execute.before"]({
          tool: "reason_argue",
          sessionID,
          callID: "call-1",
        }, { args: {} }),
      ).resolves.toBeUndefined()
    })
  })

  describe("#given zero extensions", () => {
    test("#when probabilistico is evaluated #then it returns zero without dividing by zero", () => {
      expect(evaluateProbabilistico(0, 0)).toBe(0)
    })
  })

  describe("#given weights that do not sum to one", () => {
    test("#when parsed by the schema #then validation rejects them", () => {
      expect(() =>
        PreferenceWeightsSchema.parse({ logico: 0.8, probabilistico: 0.3 }),
      ).toThrow("preference_weights must sum to 1.0")
    })
  })

  describe("#given no epistemic_gate_mode config", () => {
    test("#when an excluded conclusion is processed #then behavior matches V3 and does not block", () => {
      const sessionID = "v3.1-edge-e7"
      const hook = createEpistemicStateInterpreterHook({
        epistemic_state_interpreter_enabled: true,
      })

      storeVerdict(`${sessionID}:call-1`, {
        allow: true,
        proofArtifact: {
          theory: {},
          result: {
            semantics: "preferred",
            extensions: [{ index: 0, accepted_conclusions: [] as string[] }],
            conclusions: {
              "deny(action)": {
                conclusion: "deny(action)",
                status: "Rejected",
                proof_chain: [
                  { conclusion: "deny(action)", from: [], rule_id: null, rule_kind: "ordinary" as const },
                ],
              },
            },
          },
        },
      })

      return expect(
        hook["tool.execute.before"]({
          tool: "bash",
          sessionID,
          callID: "call-1",
        }, { args: {} }),
      ).resolves.toBeUndefined()
    })
  })
})
