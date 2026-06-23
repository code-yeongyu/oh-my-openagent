import type { ProcessedConclusion } from "../epistemic-state-interpreter/hook-v2-conclusion-processor"

function createValutazione() {
  return {
    logico: 1,
    probabilistico: 0.87,
    etico: {
      score: 0.9,
      label: "lecito" as const,
      allineamento_legale: 1,
      valore_empatico: 0.8,
      magnitudine_beneficio: 0.8,
      override: false,
      reason: "aligned_with_rules",
    },
    pragmatico: {
      score: 0.7,
      label: "conveniente" as const,
      beneficio_proprio: 0.7,
      beneficio_controparte: 0.6,
      costo_proprio: 0.1,
      costo_controparte: 0.2,
      pesatura: { proprio: 0.6, controparte: 0.4 },
    },
    morale: {
      score: 0.8,
      label: "giustificabile" as const,
      contesto_sociale: "general",
      comprensione_destinatari: "high",
      impatto_cascata: 0.2,
      intenzione: "benevola" as const,
      trasparenza: 0.9,
      fiducia_risultante: 0.8,
      reason: "socially_acceptable",
    },
    combined: 0.85,
    divergente: false,
    dettaglio_divergenza: null,
  }
}

export function createProcessedConclusionFixture(conclusion = "select_option_a"): ProcessedConclusion {
  const valutazione = createValutazione()

  return {
    annotation: {
      conclusion,
      state: {
        pianoA: "plausibile",
        pianoB: { probabile: 0.87, plausibile: true },
        pianoC: {
          inconclusivo: false,
          autosufficiente: true,
          catena_dipendenze: ["rule:strict_support"],
          ha_dipendenza_circolare: false,
        },
        pianoD: null,
      },
      rawClassification: "plausibile",
      reason: "status=Accepted extensions=1/1 transition=advanced",
      timestamp: 1,
      callID: "call-test",
      proofChainKind: "strict",
      extensionMembership: { inCount: 1, totalCount: 1 },
      valutazione,
    },
    hook: {
      id: "hook-1",
      target: conclusion,
      polarity: "positivo",
      strength: "forte",
      factors: {
        epistemici: {
          supporto_empirico: 1,
          compatibilita_strutturale: 1,
          potenziale_esplicativo: 1,
          valore_verifica: 1,
          maturita: 1,
        },
        pragmatici: {
          beneficio_potenziale: 1,
          urgenza: 1,
          costo_verifica: 0,
          rischio: 0,
        },
      },
      rationale: "classification=plausibile",
      timestamp: 1,
      sessionId: "test-session",
    },
    valutazione,
    blocked: false,
  }
}
