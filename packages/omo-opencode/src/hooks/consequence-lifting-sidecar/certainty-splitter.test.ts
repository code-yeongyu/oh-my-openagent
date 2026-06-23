/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import type { ProcessedConclusion } from "../epistemic-state-interpreter/hook-v2-conclusion-processor"
import { splitCertainty } from "./certainty-splitter"
import { runConsequenceLiftingSidecar } from "./sidecar"

function createProcessedConclusion(conclusion: string, combined = 0.9): ProcessedConclusion {
  return {
    annotation: {
      conclusion,
      state: {
        pianoA: "plausibile",
        pianoB: { probabile: combined, plausibile: true },
        pianoC: { inconclusivo: false, autosufficiente: true, catena_dipendenze: [], ha_dipendenza_circolare: false },
        pianoD: null,
      },
      rawClassification: "plausibile",
      reason: conclusion,
      timestamp: 1,
      callID: "c-1",
      proofChainKind: "strict",
      extensionMembership: { inCount: 1, totalCount: 1 },
      valutazione: {
        logico: combined,
        probabilistico: combined,
        etico: { score: combined, label: "lecito", allineamento_legale: combined, valore_empatico: combined, magnitudine_beneficio: combined, override: false, reason: null },
        pragmatico: { score: combined, label: "conveniente", beneficio_proprio: combined, beneficio_controparte: combined, costo_proprio: 0.1, costo_controparte: 0.1, pesatura: { proprio: 0.5, controparte: 0.5 } },
        morale: { score: combined, label: "giustificabile", contesto_sociale: null, comprensione_destinatari: null, impatto_cascata: combined, intenzione: "benevola", trasparenza: combined, fiducia_risultante: combined, reason: null },
        combined,
        divergente: false,
        dettaglio_divergenza: null,
      },
    },
    hook: {
      id: `${conclusion}-hook`,
      target: conclusion,
      polarity: "positivo",
      strength: "forte",
      factors: {
        epistemici: { supporto_empirico: combined, compatibilita_strutturale: combined, potenziale_esplicativo: combined, valore_verifica: 0.2, maturita: combined },
        pragmatici: { beneficio_potenziale: combined, urgenza: 0.2, costo_verifica: 0.1, rischio: 0.1 },
      },
      rationale: "test",
      timestamp: 1,
      sessionId: "s-1",
    },
    valutazione: {
      logico: combined,
      probabilistico: combined,
      etico: { score: combined, label: "lecito", allineamento_legale: combined, valore_empatico: combined, magnitudine_beneficio: combined, override: false, reason: null },
      pragmatico: { score: combined, label: "conveniente", beneficio_proprio: combined, beneficio_controparte: combined, costo_proprio: 0.1, costo_controparte: 0.1, pesatura: { proprio: 0.5, controparte: 0.5 } },
      morale: { score: combined, label: "giustificabile", contesto_sociale: null, comprensione_destinatari: null, impatto_cascata: combined, intenzione: "benevola", trasparenza: combined, fiducia_risultante: combined, reason: null },
      combined,
      divergente: false,
      dettaglio_divergenza: null,
    },
    blocked: false,
  }
}

function createArtifact(conclusion: string) {
  return {
    result: {
      semantics: "preferred",
      extensions: [{ index: 0, accepted_conclusions: [conclusion] }],
      conclusions: {
        [conclusion]: {
          conclusion,
          status: "Accepted",
          proof_chain: [
            { conclusion: "evidence:grid_failure", from: [], rule_kind: "ordinary" },
            { conclusion, from: ["evidence:grid_failure"], rule_id: `${conclusion}-rule`, rule_kind: "strict" },
          ],
        },
      },
    },
  }
}

describe("splitCertainty", () => {
  describe("#given a mostly strict unattacked proof chain", () => {
    it("#when split certainty is computed #then framework certainty is high and world certainty stays low", () => {
      const result = splitCertainty({
        proofChainKind: "strict",
        extensionMembership: { inCount: 1, totalCount: 1 },
        proofChain: [
          { conclusion: "evidence:grid_failure", from: [], rule_kind: "ordinary" },
          { conclusion: "launch_backup_generators", from: ["evidence:grid_failure"], rule_kind: "strict" },
        ],
        tags: ["value:stability"],
      })

      expect(result.framework_certainty).toBe("high")
      expect(result.world_certainty).toBe("low")
    })
  })

  describe("#given defeasible support grounded in empirical tags", () => {
    it("#when split certainty is computed #then world certainty is high and framework certainty stays low", () => {
      const result = splitCertainty({
        proofChainKind: "defeasible",
        extensionMembership: { inCount: 2, totalCount: 2 },
        proofChain: [
          { conclusion: "observation:renal_decline", from: [], rule_kind: "ordinary" },
          { conclusion: "data:icu_capacity", from: [], rule_kind: "ordinary" },
          {
            conclusion: "activate_transfer_protocol",
            from: ["observation:renal_decline", "data:icu_capacity"],
            rule_kind: "defeasible",
          },
        ],
        tags: ["observation:renal_decline", "data:icu_capacity"],
      })

      expect(result.framework_certainty).toBe("low")
      expect(result.world_certainty).toBe("high")
    })
  })

  describe("#given missing certainty signals", () => {
    it("#when split certainty is computed #then both certainties are null", () => {
      const result = splitCertainty({
        proofChainKind: null,
        extensionMembership: null,
        proofChain: null,
        tags: null,
      })

      expect(result.framework_certainty).toBeNull()
      expect(result.world_certainty).toBeNull()
    })
  })

  describe("#given sidecar output", () => {
    it("#when the sidecar builds decision profiles #then split certainty is attached backward-compatibly", () => {
      const decision = "launch_backup_generators"
      const result = runConsequenceLiftingSidecar({
        processed: [createProcessedConclusion(decision)],
        proofArtifact: createArtifact(decision),
        sessionID: "s-1",
        callID: "c-1",
      })

      expect(result.profiles[0]?.framework_certainty).toBe("high")
      expect(result.profiles[0]?.world_certainty).toBe("medium")
      expect(result.policies[0]?.profile.framework_certainty).toBe("high")
      expect(result.policies[0]?.profile.world_certainty).toBe("medium")
    })
  })
})
