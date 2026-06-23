import { describe, expect, it } from "bun:test"
import type { ProcessedConclusion } from "../epistemic-state-interpreter/hook-v2-conclusion-processor"
import { runConsequenceLiftingSidecar } from "./sidecar"

function createProcessedConclusion(input: {
  conclusion: string
  pianoA?: "plausibile" | "non_escluso" | "da_verificare" | "escluso"
  combined?: number
  blocked?: boolean
  inCount?: number
  totalCount?: number
}): ProcessedConclusion {
  const pianoA = input.pianoA ?? "plausibile"
  const combined = input.combined ?? 0.9
  const inCount = input.inCount ?? 1
  const totalCount = input.totalCount ?? 1

  return {
    annotation: {
      conclusion: input.conclusion,
      state: {
        pianoA,
        pianoB: { probabile: combined, plausibile: combined >= 0.6 },
        pianoC: {
          inconclusivo: false,
          autosufficiente: true,
          catena_dipendenze: [],
          ha_dipendenza_circolare: false,
        },
        pianoD: null,
      },
      rawClassification: pianoA,
      reason: `${input.conclusion}:${pianoA}`,
      timestamp: 1,
      callID: "call-1",
      proofChainKind: "strict",
      extensionMembership: { inCount, totalCount },
      valutazione: {
        logico: combined,
        probabilistico: combined,
        etico: {
          score: combined,
          label: "lecito",
          allineamento_legale: combined,
          valore_empatico: combined,
          magnitudine_beneficio: combined,
          override: false,
          reason: null,
        },
        pragmatico: {
          score: combined,
          label: "conveniente",
          beneficio_proprio: combined,
          beneficio_controparte: combined,
          costo_proprio: 0.1,
          costo_controparte: 0.1,
          pesatura: { proprio: 0.5, controparte: 0.5 },
        },
        morale: {
          score: combined,
          label: "giustificabile",
          contesto_sociale: null,
          comprensione_destinatari: null,
          impatto_cascata: combined,
          intenzione: "benevola",
          trasparenza: combined,
          fiducia_risultante: combined,
          reason: null,
        },
        combined,
        divergente: false,
        dettaglio_divergenza: null,
      },
    },
    hook: {
      id: `${input.conclusion}-hook`,
      target: input.conclusion,
      polarity: "positivo",
      strength: "forte",
      factors: {
        epistemici: {
          supporto_empirico: combined,
          compatibilita_strutturale: combined,
          potenziale_esplicativo: combined,
          valore_verifica: 0.2,
          maturita: combined,
        },
        pragmatici: {
          beneficio_potenziale: combined,
          urgenza: 0.2,
          costo_verifica: 0.1,
          rischio: 0.1,
        },
      },
      rationale: "test",
      timestamp: 1,
      sessionId: "session-1",
    },
    valutazione: {
      logico: combined,
      probabilistico: combined,
      etico: {
        score: combined,
        label: "lecito",
        allineamento_legale: combined,
        valore_empatico: combined,
        magnitudine_beneficio: combined,
        override: false,
        reason: null,
      },
      pragmatico: {
        score: combined,
        label: "conveniente",
        beneficio_proprio: combined,
        beneficio_controparte: combined,
        costo_proprio: 0.1,
        costo_controparte: 0.1,
        pesatura: { proprio: 0.5, controparte: 0.5 },
      },
      morale: {
        score: combined,
        label: "giustificabile",
        contesto_sociale: null,
        comprensione_destinatari: null,
        impatto_cascata: combined,
        intenzione: "benevola",
        trasparenza: combined,
        fiducia_risultante: combined,
        reason: null,
      },
      combined,
      divergente: false,
      dettaglio_divergenza: null,
    },
    blocked: input.blocked ?? false,
  }
}

function createArtifact(entries: Record<string, { status?: string; from?: string[]; kind?: "ordinary" | "strict" | "defeasible" }>) {
  const conclusions = Object.fromEntries(
    Object.entries(entries).map(([conclusion, entry]) => [
      conclusion,
      {
        conclusion,
        status: entry.status ?? "Accepted",
        proof_chain: [
          ...(entry.from ?? []).map((premise) => ({ conclusion: premise, from: [], rule_id: null, rule_kind: "ordinary" as const })),
          { conclusion, from: entry.from ?? [], rule_id: `${conclusion}-rule`, rule_kind: entry.kind ?? "strict" },
        ],
      },
    ]),
  )

  return { result: { semantics: "preferred", extensions: [{ index: 0, accepted_conclusions: Object.keys(entries) }], conclusions } }
}

describe("runConsequenceLiftingSidecar", () => {
  it("#given rivafosca-like competing decisions #when sidecar runs #then it lifts burdens benefits mitigations and qualifiers", () => {
    const processed = [
      createProcessedConclusion({ conclusion: "deploy_emergency_dialysis", combined: 0.86 }),
      createProcessedConclusion({ conclusion: "activate_transfer_protocol", combined: 0.71 }),
      createProcessedConclusion({ conclusion: "saved_vulnerable_patients", combined: 0.9 }),
      createProcessedConclusion({ conclusion: "risk_renal_collapse", combined: 0.7 }),
      createProcessedConclusion({ conclusion: "mandatory_monitoring_renal", combined: 0.8 }),
      createProcessedConclusion({ conclusion: "require_neonatal_backup", combined: 0.8 }),
      createProcessedConclusion({ conclusion: "protected_neonates", combined: 0.77 }),
    ]
    const proofArtifact = createArtifact({
      deploy_emergency_dialysis: { from: ["evidence:crisis", "value:vita_umana"], kind: "strict" },
      activate_transfer_protocol: { from: ["evidence:capacity"], kind: "strict" },
      saved_vulnerable_patients: { from: ["deploy_emergency_dialysis", "value:vita_umana"], kind: "strict" },
      risk_renal_collapse: { from: ["deploy_emergency_dialysis", "safety:renal", "pregnant"], kind: "defeasible" },
      mandatory_monitoring_renal: { from: ["risk_renal_collapse", "safety:monitoring"], kind: "strict" },
      require_neonatal_backup: { from: ["deploy_emergency_dialysis", "safety:backup"], kind: "strict" },
      protected_neonates: { from: ["activate_transfer_protocol", "value:vita_umana"], kind: "strict" },
    })

    const result = runConsequenceLiftingSidecar({ processed, proofArtifact, sessionID: "s-1", callID: "c-1" })
    const dialysis = result.policies.find((policy) => policy.primaryDecision === "deploy_emergency_dialysis")
    const transfer = result.policies.find((policy) => policy.primaryDecision === "activate_transfer_protocol")

    expect(result.graph.decisions).toEqual(["deploy_emergency_dialysis", "activate_transfer_protocol"])
    expect(dialysis?.profile.policyStatus).toBe("core_accepted_conditioned")
    expect(dialysis?.requiredConditions).toContain("require_neonatal_backup")
    expect(dialysis?.requiredMitigations).toContain("mandatory_monitoring_renal")
    expect(dialysis?.profile.qualifiers).toContain("ammissibile_solo_se_condizionata")
    expect(transfer?.profile.policyStatus).toBe("core_accepted_selectable")
  })

  it("#given a single clean decision #when sidecar runs #then it returns a selectable policy", () => {
    const result = runConsequenceLiftingSidecar({
      processed: [
        createProcessedConclusion({ conclusion: "launch_backup_generators", combined: 0.92 }),
        createProcessedConclusion({ conclusion: "preserved_power_supply", combined: 0.93 }),
      ],
      proofArtifact: createArtifact({
        launch_backup_generators: { from: ["evidence:grid_failure"], kind: "strict" },
        preserved_power_supply: { from: ["launch_backup_generators", "value:stability"], kind: "strict" },
      }),
      sessionID: "s-2",
      callID: "c-2",
    })

    expect(result.policies[0]?.profile.policyStatus).toBe("core_accepted_selectable")
    expect(result.policies[0]?.requiredMitigations).toEqual([])
    expect(result.policies[0]?.residualRisks).toEqual([])
  })

  it("#given an unmitigated strong burden #when sidecar runs #then policy is blocked", () => {
    const result = runConsequenceLiftingSidecar({
      processed: [
        createProcessedConclusion({ conclusion: "activate_heat_shutdown", combined: 0.84 }),
        createProcessedConclusion({ conclusion: "harm_elderly_patients", combined: 0.82 }),
      ],
      proofArtifact: createArtifact({
        activate_heat_shutdown: { from: ["evidence:overheat"], kind: "strict" },
        harm_elderly_patients: { from: ["activate_heat_shutdown", "safety:heat", "elderly"], kind: "strict" },
      }),
      sessionID: "s-3",
      callID: "c-3",
    })

    expect(result.policies[0]?.profile.policyStatus).toBe("core_accepted_blocked")
  })

  it("#given an infeasible decision #when sidecar runs #then it is marked non selezionabile", () => {
    const result = runConsequenceLiftingSidecar({
      processed: [createProcessedConclusion({ conclusion: "deploy_mobile_unit", combined: 0.78 })],
      proofArtifact: createArtifact({
        deploy_mobile_unit: { from: ["feasible:false", "constraint:temporal_window_closed"], kind: "strict" },
      }),
      sessionID: "s-4",
      callID: "c-4",
    })

    expect(result.policies[0]?.profile.qualifiers).toContain("non_selezionabile_infeasible")
    expect(result.policies[0]?.profile.policyStatus).toBe("core_accepted_blocked")
  })

  describe("#given a decision with an override that bypasses a burden", () => {
    describe("#when the sidecar processes an override conclusion", () => {
      it("#then the overridden burden is marked sufficiently_mitigated and override qualifier is added", () => {
        const processed = [
          createProcessedConclusion({ conclusion: "activate_emergency_protocol", pianoA: "plausibile", combined: 0.8 }),
          createProcessedConclusion({ conclusion: "consent_principle_violated", pianoA: "plausibile", combined: 0.5 }),
          createProcessedConclusion({ conclusion: "necessity_override", pianoA: "plausibile", combined: 0.9 }),
        ]

        const proofArtifact = {
          result: {
            conclusions: {
              activate_emergency_protocol: {
                conclusion: "activate_emergency_protocol",
                status: "Accepted",
                proof_chain: [
                  { conclusion: "evidence:crisis_imminent", from: [], rule_kind: "ordinary" },
                  { conclusion: "activate_emergency_protocol", from: ["evidence:crisis_imminent"], rule_id: "d1", rule_kind: "defeasible" },
                ],
              },
              consent_principle_violated: {
                conclusion: "consent_principle_violated",
                status: "Accepted",
                proof_chain: [
                  { conclusion: "activate_emergency_protocol", from: [], rule_kind: "ordinary" },
                  { conclusion: "consent_principle_violated", from: ["activate_emergency_protocol"], rule_id: "d2", rule_kind: "defeasible" },
                ],
              },
              necessity_override: {
                conclusion: "necessity_override",
                status: "Accepted",
                proof_chain: [
                  { conclusion: "consent_principle_violated", from: [], rule_kind: "ordinary" },
                  { conclusion: "value:preservation_of_life", from: [], rule_kind: "ordinary" },
                  { conclusion: "necessity_override", from: ["consent_principle_violated", "value:preservation_of_life"], rule_id: "d3", rule_kind: "defeasible" },
                ],
              },
            },
            extensions: [{ index: 0, accepted_conclusions: ["activate_emergency_protocol", "consent_principle_violated", "necessity_override"] }],
          },
        }

        const result = runConsequenceLiftingSidecar({
          processed,
          proofArtifact,
          sessionID: "override-test",
          callID: "call-override",
        })

        const profile = result.profiles.find((p) => p.decision === "activate_emergency_protocol")
        expect(profile).toBeDefined()

        const consentBurden = profile!.forwardBurdens.find((b) => b.conclusion === "consent_principle_violated")
        expect(consentBurden).toBeDefined()
        expect(consentBurden!.mitigationStatus).toBe("sufficiently_mitigated")
        expect(consentBurden!.mitigatedBy).toContain("necessity_override")

        const policy = result.policies.find((p) => p.primaryDecision === "activate_emergency_protocol")
        expect(policy).toBeDefined()
        expect(policy!.profile.qualifiers).toContain("giustificabile_in_stato_di_necessita")
        expect(policy!.profile.policyStatus).not.toBe("core_accepted_blocked")
      })
    })
  })

  it("threads semantics, cycle, and convergence context into the humility summary", () => {
    const result = runConsequenceLiftingSidecar({
      processed: [createProcessedConclusion({ conclusion: "deploy_option_a", combined: 0.94, inCount: 1, totalCount: 2 })],
      proofArtifact: {
        result: {
          semantics: "preferred",
          extensions: [{ index: 0, accepted_conclusions: ["deploy_option_a"] }],
          conclusions: {
            deploy_option_a: {
              conclusion: "deploy_option_a",
              status: "Accepted",
              proof_chain: [
                { conclusion: "value:continuity", from: [], rule_id: null, rule_kind: "ordinary" },
                { conclusion: "deploy_option_a", from: ["value:continuity"], rule_id: "d1", rule_kind: "defeasible" },
              ],
            },
          },
        },
        semantics_comparison: {
          grounded_set: ["deploy_option_b"],
          preferred_extensions: [["deploy_option_a"], ["deploy_option_c"]],
          stable_extensions: [],
          complete_extensions: [["deploy_option_a"], ["deploy_option_b"], ["deploy_option_c"]],
          certainty_gradient: {
            certain: ["deploy_option_b"],
            defensible: ["deploy_option_a", "deploy_option_c"],
            contested: [],
          },
        },
        preference_cycle_detected: true,
        preference_cycle_path: ["deploy_option_a", "deploy_option_b", "deploy_option_c", "deploy_option_a"],
        convergence: "looping",
      },
      sessionID: "s-humility",
      callID: "c-humility",
    })

    expect(result.humility?.report.summary).toContain("preferred semantics")
    expect(result.humility?.report.summary).toContain("grounded set")
    expect(result.humility?.report.summary).toContain("Preference cycle detected")
    expect(result.humility?.report.summary).toContain("looping")
  })

  it("#given an explicit no_selectable_bundle conclusion with no positive decisions #when sidecar runs #then humility reports irreparable no-selection instead of generic repairable fallback", () => {
    const result = runConsequenceLiftingSidecar({
      processed: [
        createProcessedConclusion({ conclusion: "-select_option_A", combined: 0.82 }),
        createProcessedConclusion({ conclusion: "no_selectable_bundle", combined: 0.88 }),
      ],
      proofArtifact: createArtifact({
        "-select_option_A": { from: ["option_A_surgical_mortality_31_pct"], kind: "strict" },
        no_selectable_bundle: { from: ["-select_option_A"], kind: "strict" },
      }),
      sessionID: "s-no-bundle",
      callID: "c-no-bundle",
    })

    expect(result.policies).toEqual([])
    expect(result.bundle?.selection.selectedBySlot).toEqual({})
    expect(result.humility?.report).toEqual({
      capacity: "irreparable",
      escalationReasons: [{ code: "no_selectable_bundle", message: "No policy bundle remains selectable after gating and constraints" }],
      summary: "irreparable: No policy bundle remains selectable after gating and constraints",
    })
  })

})
