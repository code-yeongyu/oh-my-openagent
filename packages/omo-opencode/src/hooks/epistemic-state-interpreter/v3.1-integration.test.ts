import { afterEach, describe, expect, test } from "bun:test"

import { _resetForTesting as resetAnnotations, getAnnotations } from "./annotation-store"
import { checkGate } from "./gate-checker"
import { _resetForTesting as resetHistory } from "./history-store"
import { createPreferenceInjectionHook } from "./preference-injection-hook"
import { clearPreferences, getPreferences, storePreference } from "./preference-store"
import { _resetForTesting as resetVerdictStore, storeVerdict } from "./verdict-store"
import { createEpistemicStateInterpreterHook } from "./hook"
import type { EpistemicAnnotation } from "./types"

type Spec = {
  conclusion: string
  status: "Accepted" | "Undecided" | "Rejected"
  proofChainKind: EpistemicAnnotation["proofChainKind"]
  extensionsIn: number
  extensionsTotal: number
}

const SESSION_IDS = [
  "v3.1-feedback-loop",
  "v3.1-dampening",
  "v3.1-circuit-breaker",
  "v3.1-gate-blocking",
]

const PREFERENCE_CONFIG = {
  preference_weights: {
    logico: 0.6,
    probabilistico: 0.4,
    etico: 0,
    pragmatico: 0,
    morale: 0,
  },
}

function buildArtifact(specs: Spec[], theory: Record<string, unknown> = {}) {
  const total = Math.max(...specs.map((spec) => spec.extensionsTotal), 0)
  const extensions = Array.from({ length: total }, (_, index) => ({
    index,
    accepted_conclusions: [] as string[],
  }))
  const conclusions: Record<string, { status: Spec["status"]; proof_chain: Array<{ conclusion: string; from: string[]; rule_id: string | null; rule_kind: Spec["proofChainKind"] | "ordinary" }> }> = {}

  for (const spec of specs) {
    conclusions[spec.conclusion] = {
      status: spec.status,
      proof_chain: [
        {
          conclusion: spec.conclusion,
          from: [],
          rule_id: spec.proofChainKind === "strict" ? "s1" : "d1",
          rule_kind: spec.proofChainKind,
        },
      ],
    }

    for (let index = 0; index < spec.extensionsIn; index += 1) {
      extensions[index]?.accepted_conclusions.push(spec.conclusion)
    }
  }

  return { theory, result: { semantics: "preferred", extensions, conclusions } }
}

afterEach(() => {
  for (const sessionID of SESSION_IDS) {
    clearPreferences(sessionID)
  }
  resetAnnotations()
  resetHistory()
  resetVerdictStore()
})

describe("epistemic-state-interpreter v3.1 integration", () => {
  describe("#given previous-cycle annotations with different proof strengths", () => {
    test("#when preference injection runs #then derived preferences are stored and injected for the next cycle", async () => {
      const sessionID = "v3.1-feedback-loop"
      const interpreterHook = createEpistemicStateInterpreterHook({
        epistemic_state_interpreter_enabled: true,
      })
      const preferenceHook = createPreferenceInjectionHook(PREFERENCE_CONFIG)

      storeVerdict(`${sessionID}:cycle-1`, {
        allow: true,
        proofArtifact: buildArtifact([
          {
            conclusion: "strict-win",
            status: "Accepted",
            proofChainKind: "strict",
            extensionsIn: 1,
            extensionsTotal: 1,
          },
          {
            conclusion: "defeasible-loss",
            status: "Undecided",
            proofChainKind: "defeasible",
            extensionsIn: 0,
            extensionsTotal: 1,
          },
        ]),
      })

      await interpreterHook["tool.execute.before"]({
        tool: "bash",
        sessionID,
        callID: "cycle-1",
      }, { args: {} })

      const output = {
        args: {
          theory: {
            preferences: [] as Array<{ superior: string; inferior: string }>,
          },
        },
      }

      await preferenceHook["tool.execute.before"]({
        tool: "reason_argue",
        sessionID,
        callID: "cycle-2",
      }, output)

      expect(getAnnotations(sessionID)).toHaveLength(2)
      expect(getPreferences(sessionID).has("strict-win>defeasible-loss")).toBe(true)
      expect(output.args.theory.preferences).toContainEqual({
        superior: "strict-win",
        inferior: "defeasible-loss",
      })
    })
  })

  describe("#given a stored preference at 0.8", () => {
    test("#when a new value at 0.5 is proposed #then dampening clamps the applied value to 0.6", () => {
      const sessionID = "v3.1-dampening"

      storePreference(sessionID, { superior: "rule-a", inferior: "rule-b", strength: 0.8 })
      const result = storePreference(sessionID, { superior: "rule-a", inferior: "rule-b", strength: 0.5 })

      expect(result.applied).toBeCloseTo(0.6)
      expect(getPreferences(sessionID).get("rule-a>rule-b")?.combined).toBeCloseTo(0.6)
    })
  })

  describe("#given oscillating preference updates", () => {
    test("#when the fifth reversal occurs #then the circuit breaker freezes the preference", () => {
      const sessionID = "v3.1-circuit-breaker"

      storePreference(sessionID, { superior: "rule-a", inferior: "rule-b", strength: 0.5 })
      storePreference(sessionID, { superior: "rule-a", inferior: "rule-b", strength: 0.8 })
      storePreference(sessionID, { superior: "rule-a", inferior: "rule-b", strength: 0.3 })
      storePreference(sessionID, { superior: "rule-a", inferior: "rule-b", strength: 0.8 })
      storePreference(sessionID, { superior: "rule-a", inferior: "rule-b", strength: 0.3 })
      storePreference(sessionID, { superior: "rule-a", inferior: "rule-b", strength: 0.8 })
      const finalResult = storePreference(sessionID, {
        superior: "rule-a",
        inferior: "rule-b",
        strength: 0.3,
      })

      expect(finalResult.cycleState.oscillationCount).toBe(5)
      expect(finalResult.cycleState.frozen).toBe(true)
      expect(getPreferences(sessionID).get("rule-a>rule-b")?.cycleState.frozen).toBe(true)
    })
  })

  describe("#given gate mode and an excluded conclusion", () => {
    test("#when the gate is checked #then execution is blocked with a descriptive reason", () => {
      const result = checkGate("excluded", "gate", "test(conclusion)")

      expect(result.allowed).toBe(false)
      expect(result.reason).toBe(
        "gate mode: conclusion 'test(conclusion)' blocked (state=excluded, below 'open')",
      )
    })
  })
})
