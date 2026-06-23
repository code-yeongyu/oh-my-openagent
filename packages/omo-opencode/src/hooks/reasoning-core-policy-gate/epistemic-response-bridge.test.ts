import { describe, expect, it } from "bun:test"
import { createProcessedConclusionFixture } from "./epistemic-analysis-test-fixtures"
import { mapProcessedConclusionsToEpistemicAnalysis } from "./epistemic-response-bridge"

describe("mapProcessedConclusionsToEpistemicAnalysis", () => {
  it("#when processed conclusions include evaluator outputs #then piano_c exposes nested ethical moral and pragmatic assessments", () => {
    const result = mapProcessedConclusionsToEpistemicAnalysis([createProcessedConclusionFixture()])

    expect(result?.piano_c).toEqual({
      etico: {
        deontological: { select_option_a: 1 },
        consequentialist: { select_option_a: 0.8 },
        virtue_ethics: { select_option_a: 0.8 },
      },
      morale: {
        select_option_a: {
          score: 0.8,
          label: "giustificabile",
          contesto_sociale: "general",
          comprensione_destinatari: "high",
          impatto_cascata: 0.2,
          intenzione: "benevola",
          trasparenza: 0.9,
          fiducia_risultante: 0.8,
          reason: "socially_acceptable",
        },
      },
      pragmatico: {
        select_option_a: {
          score: 0.7,
          label: "conveniente",
          beneficio_proprio: 0.7,
          beneficio_controparte: 0.6,
          costo_proprio: 0.1,
          costo_controparte: 0.2,
          pesatura: { proprio: 0.6, controparte: 0.4 },
        },
      },
    })
  })

  it("#when evaluator outputs only exist on annotation state #then bridge falls back to state payloads", () => {
    const processedConclusion = createProcessedConclusionFixture()

    Reflect.set(processedConclusion, "valutazione", undefined)
    processedConclusion.annotation.valutazione = null
    Reflect.set(processedConclusion.annotation.state, "etico", {
      score: 0.91,
      label: "override_giustificato",
      allineamento_legale: 0.2,
      valore_empatico: 0.95,
      magnitudine_beneficio: 0.9,
      override: true,
      reason: null,
    })
    Reflect.set(processedConclusion.annotation.state, "morale", {
      score: 0.72,
      label: "dipendente_dal_contesto",
      contesto_sociale: "vulnerable",
      comprensione_destinatari: "vulnerable (0.2)",
      impatto_cascata: 0.45,
      intenzione: "neutra",
      trasparenza: 0.6,
      fiducia_risultante: 0.55,
      reason: null,
    })
    Reflect.set(processedConclusion.annotation.state, "pragmatico", {
      score: 0.51,
      label: "condizionata",
      beneficio_proprio: 0.55,
      beneficio_controparte: 0.5,
      costo_proprio: 0.45,
      costo_controparte: 0.5,
      pesatura: { proprio: 0.6, controparte: 0.4 },
    })

    const result = mapProcessedConclusionsToEpistemicAnalysis([processedConclusion])

    expect(result?.piano_c).toEqual({
      etico: {
        deontological: { select_option_a: 0.2 },
        consequentialist: { select_option_a: 0.9 },
        virtue_ethics: { select_option_a: 0.95 },
      },
      morale: {
        select_option_a: {
          score: 0.72,
          label: "dipendente_dal_contesto",
          contesto_sociale: "vulnerable",
          comprensione_destinatari: "vulnerable (0.2)",
          impatto_cascata: 0.45,
          intenzione: "neutra",
          trasparenza: 0.6,
          fiducia_risultante: 0.55,
          reason: null,
        },
      },
      pragmatico: {
        select_option_a: {
          score: 0.51,
          label: "condizionata",
          beneficio_proprio: 0.55,
          beneficio_controparte: 0.5,
          costo_proprio: 0.45,
          costo_controparte: 0.5,
          pesatura: { proprio: 0.6, controparte: 0.4 },
        },
      },
    })
  })

  it("#when top-ranked Piano D conclusion is negated #then synthesis phrases it as a rejection instead of raw negation syntax", () => {
    const processedConclusion = createProcessedConclusionFixture("-document_2019_controls")
    processedConclusion.annotation.state.pianoD = {
      ranking: [{ conclusion: "-document_2019_controls", score: 0.9345 }],
      dominante: null,
      margine: 0,
      preferibile_ma_non_certo: false,
      assi_convergenti: [],
      assi_divergenti: [],
    }

    const result = mapProcessedConclusionsToEpistemicAnalysis([processedConclusion])

    expect(result?.piano_d).toEqual({
      synthesis: "No dominant conclusion. Strongest signal is rejection of document_2019_controls (margin 0.0000).",
      confidence: 0.9345,
    })
  })
})
