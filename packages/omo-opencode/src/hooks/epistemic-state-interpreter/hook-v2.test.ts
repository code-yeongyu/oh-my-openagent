import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as loggerModule from "../../shared/logger"
import type { EpistemicGateMode } from "../../config/schema/epistemic-gate"
import type { MultiPlaneGateResult } from "./gate-checker-v2"
import type {
  EpistemicHook,
  HookFactors,
  HookPolarity,
  HookStrength,
} from "./hook-entity-types"
import type {
  DominanzaDecisionale,
  EticoOutput,
  MoraleOutput,
  MultiPlaneAnnotation,
  PragmaticoOutput,
  ValutazioneMultiAsse,
} from "./multi-plane-types"
import type { PianoDInput } from "./piano-d-engine"
import type {
  DerivedPreference,
  PreferenceDerivationInput,
} from "./preference-derivation-v2"
import type { ParsedProofArtifact } from "./proof-artifact-parser"
import type { TransitionResult } from "./transition-engine-v2"
import type { AnalyzedProofChain } from "./v5-types"
import type { ProcessConclusionInput, ProcessedConclusion } from "./hook-v2-conclusion-processor"
import { createMultiPlaneHook } from "./hook-v2"
import type { PolicyVerdict } from "../reasoning-core-policy-gate/types"

function createChain(): AnalyzedProofChain {
  return {
    ruleIds: ["r1"],
    antecedents: new Map([["r1", ["premise:alpha"]]]),
    depth: 2,
    hasCircularDependency: false,
    allPremisesOrdinary: false,
  }
}

function createEtico(): EticoOutput {
  return {
    score: 0.8,
    label: "lecito",
    allineamento_legale: 0.9,
    valore_empatico: 0.7,
    magnitudine_beneficio: 0.6,
    override: false,
    reason: null,
  }
}

function createPragmatico(): PragmaticoOutput {
  return {
    score: 0.7,
    label: "conveniente",
    beneficio_proprio: 0.8,
    beneficio_controparte: 0.6,
    costo_proprio: 0.2,
    costo_controparte: 0.4,
    pesatura: { proprio: 0.6, controparte: 0.4 },
  }
}

function createMorale(): MoraleOutput {
  return {
    score: 0.75,
    label: "giustificabile",
    contesto_sociale: "general",
    comprensione_destinatari: "general (0.5)",
    impatto_cascata: 0.3,
    intenzione: "benevola",
    trasparenza: 0.8,
    fiducia_risultante: 0.8,
    reason: null,
  }
}

function createDerivedPreference(
  input: { conclusion: string },
  overrides: Partial<DerivedPreference> = {},
): DerivedPreference {
  return {
    conclusion: input.conclusion,
    scores: {
      logico: 0.9,
      probabilistico: 1,
      etico: 0.8,
      pragmatico: 0.7,
      morale: 0.75,
    },
    combined: 0.82,
    divergente: false,
    dettaglio_divergenza: null,
    derivationTrace: [],
    blocked: false,
    blockReason: null,
    ...overrides,
  }
}

function createValutazione(
  input: PreferenceDerivationInput,
  overrides: Partial<ValutazioneMultiAsse> = {},
): ValutazioneMultiAsse {
  return {
    logico: input.logico,
    probabilistico: input.probabilistico,
    etico: input.etico,
    pragmatico: input.pragmatico,
    morale: input.morale,
    combined: 0.82,
    divergente: false,
    dettaglio_divergenza: null,
    ...overrides,
  }
}

function createDominanza(input: PianoDInput): DominanzaDecisionale {
  return {
    ranking: input.conclusions.map((entry) => ({
      conclusion: entry.conclusion,
      score: entry.valutazione.combined,
    })),
    dominante: input.conclusions[0]?.conclusion ?? null,
    margine: input.conclusions.length > 1 ? 0.2 : 1,
    preferibile_ma_non_certo: false,
    assi_convergenti: ["logico", "probabilistico"],
    assi_divergenti: [],
  }
}

let parsedArtifactResult: ParsedProofArtifact | null
let analyzedChainResult: AnalyzedProofChain
let pianoBResult: { probabile: number | null; plausibile: boolean }
let pianoCResult: MultiPlaneAnnotation["state"]["pianoC"]
let logicoResult: number
let probabilisticoResult: number
let eticoResult: EticoOutput
let pragmaticoResult: PragmaticoOutput
let moraleResult: MoraleOutput
let rawClassificationResult: MultiPlaneAnnotation["rawClassification"]
let transitionResolver: (currentState: MultiPlaneAnnotation["rawClassification"]) => TransitionResult
let derivedPreferenceResolver: (input: { conclusion: string }) => DerivedPreference
let valutazioneResolver: (input: PreferenceDerivationInput, derived: DerivedPreference) => ValutazioneMultiAsse
let pianoDResolver: (input: PianoDInput) => DominanzaDecisionale
let gateResolver: (conclusion: string) => MultiPlaneGateResult

const storedAnnotations: Array<[string, MultiPlaneAnnotation[]]> = []
const storedHooks: Array<[string, EpistemicHook[]]> = []
const gateCalls: Array<[MultiPlaneAnnotation["state"], EpistemicGateMode, string]> = []
const createdHooks: Array<{
  sessionId: string
  target: string
  polarity: HookPolarity
  strength: HookStrength
  factors: HookFactors
  rationale: string
}> = []

const parseProofArtifact = mock((_response: unknown): ParsedProofArtifact | null => parsedArtifactResult)
const classifyPianoA = mock((_input?: unknown) => rawClassificationResult)
const analyzeProofChain = mock((_response?: unknown, _conclusion?: unknown) => analyzedChainResult)
const computePianoB = mock((_membership?: unknown, _chain?: unknown, _weights?: unknown, _threshold?: unknown) => pianoBResult)
const computePianoC = mock((_chain?: unknown, _membership?: unknown) => pianoCResult)
const evaluateLogico = mock((_proofChainKind?: unknown) => logicoResult)
const evaluateProbabilistico = mock((_extensionsIn?: unknown, _extensionsTotal?: unknown) => probabilisticoResult)
const evaluateEtico = mock((_input?: unknown) => eticoResult)
const evaluatePragmatico = mock((_input?: unknown) => pragmaticoResult)
const evaluateMorale = mock((_input?: unknown) => moraleResult)
const derivePreference = mock((input: PreferenceDerivationInput): DerivedPreference =>
  derivedPreferenceResolver(input),
)
const toValutazioneMultiAsse = mock(
  (derived: DerivedPreference, input: PreferenceDerivationInput): ValutazioneMultiAsse =>
    valutazioneResolver(input, derived),
)
const createHook = mock(
  (
    sessionId: string,
    target: string,
    polarity: HookPolarity,
    strength: HookStrength,
    factors: HookFactors,
    rationale: string,
  ): EpistemicHook => {
    createdHooks.push({ sessionId, target, polarity, strength, factors, rationale })

    return {
      id: `${target}-${polarity}`,
      target,
      polarity,
      strength,
      factors,
      rationale,
      timestamp: 1,
      sessionId,
    }
  },
)
const getHookBalance = mock((_: string, target: string) => ({
  target,
  positiveCount: 1,
  negativeCount: 0,
  positiveStrengthSum: 1,
  negativeStrengthSum: 0,
  netForce: 1,
  direction: "retention" as const,
}))
const computeTransitionV2 = mock(
  (currentState: MultiPlaneAnnotation["rawClassification"], _hookBalance?: unknown, _thresholds?: unknown, _plausibile?: unknown): TransitionResult =>
    transitionResolver(currentState),
)
const computePianoD = mock((input: PianoDInput): DominanzaDecisionale => pianoDResolver(input))
const storeMultiPlaneAnnotations = mock((sessionID: string, annotations: MultiPlaneAnnotation[]): void => {
  storedAnnotations.push([sessionID, annotations])
})
const storeSessionHooks = mock((sessionID: string, hooks: EpistemicHook[]): void => {
  storedHooks.push([sessionID, hooks])
})
const persistedSessions: string[] = []
const persistAnnotationsForSession = mock((sessionID: string): void => {
  persistedSessions.push(sessionID)
})
let storedPolicyVerdict: PolicyVerdict | undefined
const verdictLookupKeys: string[] = []
const getVerdict = mock((key: string): PolicyVerdict | undefined => {
  verdictLookupKeys.push(key)
  return storedPolicyVerdict
})
const checkMultiPlaneGate = mock(
  (
    state: MultiPlaneAnnotation["state"],
    mode: EpistemicGateMode,
    conclusion: string,
  ): MultiPlaneGateResult => {
    gateCalls.push([state, mode, conclusion])
    return gateResolver(conclusion)
  },
)

const processConclusion = mock((input: ProcessConclusionInput): ProcessedConclusion => {
  const rawClassification = classifyPianoA({
    status: input.parsedConclusion.status,
    extensionsIn: input.parsedConclusion.extensionsIn,
    extensionsTotal: input.extensionCount,
    proofChainKind: input.parsedConclusion.proofChainKind,
    hasResidualDefeasibleSupport: input.parsedConclusion.hasResidualDefeasibleSupport,
  })
  const chain = analyzeProofChain(input.response, input.conclusion)
  const pianoB = computePianoB()
  const pianoC = computePianoC()
  const logico = evaluateLogico()
  const probabilistico = evaluateProbabilistico()
  const etico = evaluateEtico()
  const pragmatico = evaluatePragmatico()
  const morale = evaluateMorale()
  const derivedPreference = derivePreference({
    conclusion: input.conclusion,
    logico,
    probabilistico,
    etico,
    pragmatico,
    morale,
  })
  const valutazione = toValutazioneMultiAsse(derivedPreference, {
    conclusion: input.conclusion,
    logico,
    probabilistico,
    etico,
    pragmatico,
    morale,
  })
  const hook = createHook(
    input.sessionID,
    input.conclusion,
    rawClassification === "escluso" ? "negativo" : "positivo",
    rawClassification === "escluso" ? "forte" : "debole",
    {
      epistemici: {
        supporto_empirico: probabilistico,
        compatibilita_strutturale: logico,
        potenziale_esplicativo: pianoB.probabile ?? 0,
        valore_verifica: pianoC.inconclusivo ? 0 : 1,
        maturita: derivedPreference.blocked ? 0.25 : 0.75,
      },
      pragmatici: {
        beneficio_potenziale: pragmatico.score,
        urgenza: etico.score ?? 0,
        costo_verifica: chain.depth > 2 ? 0.6 : 0.2,
        rischio: derivedPreference.blocked ? 0.9 : 0.1,
      },
    },
    `classification=${rawClassification}`,
  )
  const transition = computeTransitionV2(rawClassification)

  return {
    annotation: {
      conclusion: input.conclusion,
      rawClassification,
      state: {
        pianoA: transition.to,
        pianoB,
        pianoC,
        pianoD: null,
      },
      reason: transition.reason,
      timestamp: input.timestamp,
      callID: input.callID,
      proofChainKind: input.parsedConclusion.proofChainKind,
      extensionMembership: {
        inCount: input.parsedConclusion.extensionsIn,
        totalCount: input.extensionCount,
      },
      valutazione,
    },
    hook,
    valutazione,
    blocked: derivedPreference.blocked,
  }
})

function createTestHook(config = BASE_CONFIG) {
  return createMultiPlaneHook(config, {
    log: loggerModule.log,
    parseProofArtifact,
    processConclusion,
    computePianoD,
    storeSessionHooks,
    storeMultiPlaneAnnotations,
    persistAnnotationsForSession,
    checkMultiPlaneGate,
    getVerdict,
  })
}

const BASE_CONFIG = {
  enabled: true,
  epistemic_gate_mode: "hybrid" as const,
  plausibilita_threshold: 0.6,
  ethical_value_hierarchy: ["vita_umana", "autonomia"],
  pragmatic_weights: { peso_proprio: 0.6, peso_controparte: 0.4 },
  moral_context_defaults: {
    default_audience: "general" as const,
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

function createParsedArtifact(
  entries: Array<[
    string,
    {
      status?: string
      proofChainKind?: "strict" | "defeasible" | "mixed" | "unknown"
      hasResidualDefeasibleSupport?: boolean
      extensionsIn?: number
    }?,
  ]>,
  extensionCount = 1,
): ParsedProofArtifact {
  return {
    extensionCount,
    conclusions: new Map(
      entries.map(([conclusion, override]) => [
        conclusion,
        {
          status: override?.status ?? "Accepted",
          proofChainKind: override?.proofChainKind ?? "strict",
          hasResidualDefeasibleSupport: override?.hasResidualDefeasibleSupport ?? false,
          extensionsIn: override?.extensionsIn ?? extensionCount,
        },
      ]),
    ),
  }
}

beforeEach(() => {
  parsedArtifactResult = null
  analyzedChainResult = createChain()
  pianoBResult = { probabile: 0.8, plausibile: true }
  pianoCResult = {
    inconclusivo: false,
    autosufficiente: true,
    catena_dipendenze: ["premise:alpha"],
    ha_dipendenza_circolare: false,
  }
  logicoResult = 0.9
  probabilisticoResult = 1
  eticoResult = createEtico()
  pragmaticoResult = createPragmatico()
  moraleResult = createMorale()
  rawClassificationResult = "plausibile"
  transitionResolver = (currentState) => ({
    from: currentState,
    to: currentState,
    transitioned: false,
    reason: "no change",
  })
  derivedPreferenceResolver = (input) => createDerivedPreference(input)
  valutazioneResolver = (input) => createValutazione(input)
  pianoDResolver = (input) => createDominanza(input)
  gateResolver = (conclusion) => ({
    allowed: true,
    reason: `${conclusion} allowed`,
    plane: "none",
  })

  storedAnnotations.length = 0
  storedHooks.length = 0
  gateCalls.length = 0
  createdHooks.length = 0
  persistedSessions.length = 0
  storedPolicyVerdict = undefined
  verdictLookupKeys.length = 0
  getVerdict.mockClear()

  parseProofArtifact.mockClear()
  classifyPianoA.mockClear()
  analyzeProofChain.mockClear()
  computePianoB.mockClear()
  computePianoC.mockClear()
  evaluateLogico.mockClear()
  evaluateProbabilistico.mockClear()
  evaluateEtico.mockClear()
  evaluatePragmatico.mockClear()
  evaluateMorale.mockClear()
  derivePreference.mockClear()
  toValutazioneMultiAsse.mockClear()
  createHook.mockClear()
  getHookBalance.mockClear()
  computeTransitionV2.mockClear()
  computePianoD.mockClear()
  storeMultiPlaneAnnotations.mockClear()
  storeSessionHooks.mockClear()
  persistAnnotationsForSession.mockClear()
  checkMultiPlaneGate.mockClear()
})

describe("createMultiPlaneHook", () => {
  it("#given disabled config #when the handler runs #then it does nothing", async () => {
    const hook = createTestHook({ ...BASE_CONFIG, enabled: false })

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ignored" } },
    )

    expect(parseProofArtifact).not.toHaveBeenCalled()
    expect(storedAnnotations).toHaveLength(0)
  })

  it("#given a non-epistemic tool #when the handler runs #then it does nothing", async () => {
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "bash", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ignored" } },
    )

    expect(parseProofArtifact).not.toHaveBeenCalled()
    expect(storedAnnotations).toHaveLength(0)
  })

  it("#given an unparsable response #when the handler runs #then it returns early", async () => {
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ignored" } },
    )

    expect(storedAnnotations).toHaveLength(0)
    expect(gateCalls).toHaveLength(0)
  })

  it("#given a reason_solve response #when the handler runs #then it processes it like reason_argue", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha"]])
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_solve", sessionID: "session-1", callID: "call-1" },
      { response: { result: "solve" } },
    )

    expect(parseProofArtifact).toHaveBeenCalledWith({ result: "solve" })
    expect(storedAnnotations).toHaveLength(1)
  })

  it("#given one accepted conclusion #when the handler runs #then it stores the expected multi-plane annotation", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha"]])
    rawClassificationResult = "non_escluso"
    transitionResolver = () => ({
      from: "non_escluso",
      to: "da_verificare",
      transitioned: true,
      reason: "advanced",
    })
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ok" } },
    )

    const annotation = storedAnnotations[0]?.[1][0]
    expect(annotation).toMatchObject({
      conclusion: "alpha",
      rawClassification: "non_escluso",
      state: {
        pianoA: "da_verificare",
        pianoB: { probabile: 0.8, plausibile: true },
        pianoC: {
          inconclusivo: false,
          autosufficiente: true,
          catena_dipendenze: ["premise:alpha"],
          ha_dipendenza_circolare: false,
        },
      },
      proofChainKind: "strict",
      extensionMembership: { inCount: 1, totalCount: 1 },
      callID: "call-1",
    })
    expect(annotation?.valutazione?.combined).toBe(0.82)
  })

  it("#given one excluded conclusion #when gate check blocks it #then the handler throws an epistemic gate error", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha", { status: "Rejected" }]])
    rawClassificationResult = "escluso"
    gateResolver = () => ({
      allowed: false,
      reason: "gate mode: conclusion 'alpha' blocked by pianoA (state=escluso)",
      plane: "pianoA",
    })
    const hook = createTestHook(BASE_CONFIG)

    await expect(
      hook["tool.execute.after"](
        { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
        { response: { result: "blocked" } },
      ),
    ).rejects.toThrow("[epistemic gate] gate mode: conclusion 'alpha' blocked by pianoA (state=escluso)")
  })

  it("#given multiple conclusions #when the handler runs #then it computes piano D once and attaches it to each annotation", async () => {
    parsedArtifactResult = createParsedArtifact(
      [
        ["alpha", { proofChainKind: "strict" }],
        ["beta", { proofChainKind: "defeasible", extensionsIn: 1 }],
      ],
      2,
    )
    derivedPreferenceResolver = (input) =>
      createDerivedPreference(input, {
        combined: input.conclusion === "alpha" ? 0.9 : 0.4,
        blocked: input.conclusion === "beta",
        blockReason: input.conclusion === "beta" ? "blocked" : null,
      })
    valutazioneResolver = (input, derived) => createValutazione(input, { combined: derived.combined })
    pianoDResolver = () => ({
      ranking: [
        { conclusion: "alpha", score: 0.9 },
        { conclusion: "beta", score: 0.2 },
      ],
      dominante: "alpha",
      margine: 0.7,
      preferibile_ma_non_certo: false,
      assi_convergenti: ["logico", "probabilistico", "etico"],
      assi_divergenti: ["pragmatico"],
    })
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ranked" } },
    )

    expect(computePianoD).toHaveBeenCalledTimes(1)
    expect(storedAnnotations[0]?.[1][0]?.state.pianoD?.dominante).toBe("alpha")
    expect(storedAnnotations[0]?.[1][1]?.state.pianoD?.ranking).toEqual([
      { conclusion: "alpha", score: 0.9 },
      { conclusion: "beta", score: 0.2 },
    ])
  })

  it("#given one accepted conclusion #when the handler runs #then it stores annotations in annotation-store-v2", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha"]])
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-42", callID: "call-7" },
      { response: { result: "ok" } },
    )

    expect(storedAnnotations).toEqual([
      ["session-42", expect.arrayContaining([expect.objectContaining({ conclusion: "alpha" })])],
    ])
  })

  it("#given multiple conclusions #when the handler runs #then it applies the gate check to each final annotation", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha"], ["beta"]], 2)
    pianoDResolver = () => ({
      ranking: [
        { conclusion: "alpha", score: 0.9 },
        { conclusion: "beta", score: 0.8 },
      ],
      dominante: "alpha",
      margine: 0.1,
      preferibile_ma_non_certo: true,
      assi_convergenti: ["logico"],
      assi_divergenti: [],
    })
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ok" } },
    )

    expect(gateCalls).toHaveLength(2)
    expect(gateCalls[0]?.[1]).toBe("hybrid")
    expect(gateCalls[0]?.[0].pianoD?.dominante).toBe("alpha")
    expect(gateCalls[1]?.[2]).toBe("beta")
  })

  it("#given one accepted conclusion #when the handler runs #then it logs quietly without writing to stderr", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha"]])
    const stderrSpy = spyOn(process.stderr, "write").mockReturnValue(true)
    const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ok" } },
    )

    expect(stderrSpy).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[epistemic-v2] annotation updated"),
      expect.objectContaining({ sessionID: "session-1", conclusion: "alpha" }),
    )

    stderrSpy.mockRestore()
    logSpy.mockRestore()
  })

  it("#given one accepted conclusion #when the handler runs #then all four planes are populated on the stored annotation", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha"]])
    pianoDResolver = () => ({
      ranking: [{ conclusion: "alpha", score: 0.82 }],
      dominante: "alpha",
      margine: 1,
      preferibile_ma_non_certo: false,
      assi_convergenti: ["logico", "probabilistico", "etico", "pragmatico", "morale"],
      assi_divergenti: [],
    })
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ok" } },
    )

    const annotation = storedAnnotations[0]?.[1][0]
    expect(annotation?.state.pianoA).toBeDefined()
    expect(annotation?.state.pianoB).toEqual({ probabile: 0.8, plausibile: true })
    expect(annotation?.state.pianoC).toEqual({
      inconclusivo: false,
      autosufficiente: true,
      catena_dipendenze: ["premise:alpha"],
      ha_dipendenza_circolare: false,
    })
    expect(annotation?.state.pianoD?.dominante).toBe("alpha")
  })

  it("#given one conclusion #when the handler runs #then it stores the generated session hooks", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha"]])
    rawClassificationResult = "plausibile"
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ok" } },
    )

    expect(createdHooks[0]).toMatchObject({
      sessionId: "session-1",
      target: "alpha",
      polarity: "positivo",
    })
    expect(createdHooks[0]?.rationale).toContain("plausibile")
    expect(storedHooks[0]).toEqual([
      "session-1",
      expect.arrayContaining([expect.objectContaining({ target: "alpha", polarity: "positivo" })]),
    ])
  })

  it("#given one accepted conclusion #when the handler runs #then it persists annotations for the session", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha"]])
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-42", callID: "call-7" },
      { response: { result: "ok" } },
    )

    expect(persistedSessions).toContain("session-42")
  })

  it("#given the handler fails parsing #when the handler runs #then it does not call persistAnnotationsForSession", async () => {
    parsedArtifactResult = null
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ignored" } },
    )

    expect(persistedSessions).toHaveLength(0)
  })

  it("#given storeMultiPlaneAnnotations completes #when the handler runs #then persistAnnotationsForSession is called after it", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha"]])
    const callOrder: string[] = []
    const orderedStore = mock((sessionID: string, _annotations: MultiPlaneAnnotation[]): void => {
      callOrder.push(`store:${sessionID}`)
    })
    const orderedPersist = mock((sessionID: string): void => {
      callOrder.push(`persist:${sessionID}`)
    })
    const hook = createMultiPlaneHook(BASE_CONFIG, {
      log: loggerModule.log,
      parseProofArtifact,
      processConclusion,
      computePianoD,
      storeSessionHooks,
      storeMultiPlaneAnnotations: orderedStore,
      persistAnnotationsForSession: orderedPersist,
      checkMultiPlaneGate,
      getVerdict,
    })

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ok" } },
    )

    expect(callOrder).toEqual(["store:session-1", "persist:session-1"])
  })

  it("#given a parsed reasoning result #when the handler runs #then it looks up the policy verdict by sessionID:callID", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha"]])
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-99", callID: "call-77" },
      { response: { result: "ok" } },
    )

    expect(verdictLookupKeys).toContain("session-99:call-77")
  })

  it("#given a stored allow verdict #when the handler runs #then the annotation carries the policyVerdict", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha"]])
    storedPolicyVerdict = { allow: true, proofArtifact: { result: {}, theory: {} } }
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ok" } },
    )

    const annotation = storedAnnotations[0]?.[1][0]
    expect(annotation?.policyVerdict).toEqual(storedPolicyVerdict)
  })

  it("#given no stored verdict #when the handler runs #then the annotation.policyVerdict is null", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha"]])
    storedPolicyVerdict = undefined
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ok" } },
    )

    const annotation = storedAnnotations[0]?.[1][0]
    expect(annotation?.policyVerdict).toBeNull()
  })

  it("#given a denied verdict #when the handler runs #then the annotation.policyVerdict.allow is false", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha"]])
    storedPolicyVerdict = { allow: false, reason: "catastrophic_blocked" }
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ok" } },
    )

    const annotation = storedAnnotations[0]?.[1][0]
    expect(annotation?.policyVerdict?.allow).toBe(false)
    expect(annotation?.policyVerdict?.reason).toBe("catastrophic_blocked")
  })

  it("#given multiple conclusions and one verdict #when the handler runs #then every annotation carries the same verdict object", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha"], ["beta"]], 2)
    storedPolicyVerdict = { allow: true, proofArtifact: { result: {}, theory: {} } }
    pianoDResolver = () => ({
      ranking: [
        { conclusion: "alpha", score: 0.9 },
        { conclusion: "beta", score: 0.8 },
      ],
      dominante: "alpha",
      margine: 0.1,
      preferibile_ma_non_certo: false,
      assi_convergenti: ["logico"],
      assi_divergenti: [],
    })
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ok" } },
    )

    const annotations = storedAnnotations[0]?.[1]
    expect(annotations).toHaveLength(2)
    expect(annotations?.[0]?.policyVerdict).toBe(annotations?.[1]?.policyVerdict)
    expect(annotations?.[0]?.policyVerdict?.allow).toBe(true)
  })

  it("#given verdict lookup performed once per call #when the handler runs with multiple conclusions #then getVerdict is invoked exactly once", async () => {
    parsedArtifactResult = createParsedArtifact([["alpha"], ["beta"], ["gamma"]], 3)
    storedPolicyVerdict = { allow: true }
    const hook = createTestHook(BASE_CONFIG)

    await hook["tool.execute.after"](
      { tool: "reason_argue", sessionID: "session-1", callID: "call-1" },
      { response: { result: "ok" } },
    )

    expect(verdictLookupKeys.filter((k) => k === "session-1:call-1")).toHaveLength(1)
  })
})
