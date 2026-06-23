export type AmmissibilitaState =
  | "possibile"
  | "non_escluso"
  | "da_verificare"
  | "plausibile"
  | "escluso_operativamente"
  | "escluso"

export interface ForzaQuantitativa {
  probabile: number | null
  plausibile: boolean
}

export interface PotenzaInferenziale {
  inconclusivo: boolean
  autosufficiente: boolean | null
  catena_dipendenze: string[]
  ha_dipendenza_circolare: boolean
}

export type AudienceConsensusKind = "unanimous" | "majority" | "split" | "no_data"

export interface AudienceConsensusSummary {
  kind: AudienceConsensusKind
  choice: string | null
  agreeing_audiences: string[]
  dissenting_audiences: string[]
  no_selection_audiences: string[]
}

export interface DominanzaDecisionale {
  ranking: Array<{ conclusion: string; score: number }>
  dominante: string | null
  margine: number
  preferibile_ma_non_certo: boolean
  assi_convergenti: string[]
  assi_divergenti: string[]
  pareto_optimal: string[]
  incomparable_pairs: Array<[string, string]>
  audience_consensus: AudienceConsensusSummary | null
  decision_kind: "pareto_unique" | "pareto_with_audience_consensus" | "pareto_with_audience_majority" | "contested" | "all_blocked" | "empty"
}

export interface ValutazioneMultiAsse {
  logico: number
  probabilistico: number
  etico: EticoOutput
  pragmatico: PragmaticoOutput
  morale: MoraleOutput
  combined: number
  divergente: boolean
  dettaglio_divergenza: string | null
}

export type EticoLabel = "lecito" | "illecito" | "override_giustificato"

export interface EticoOutput {
  score: number | null
  label: EticoLabel | null
  allineamento_legale: number
  valore_empatico: number
  magnitudine_beneficio: number
  override: boolean
  reason: string | null
}

export type PragmaticoLabel = "conveniente" | "sconveniente" | "condizionata"

export interface PragmaticoOutput {
  score: number
  label: PragmaticoLabel
  beneficio_proprio: number
  beneficio_controparte: number
  costo_proprio: number
  costo_controparte: number
  pesatura: { proprio: number; controparte: number }
}

export type MoraleLabel = "giustificabile" | "problematica" | "dipendente_dal_contesto"

export interface MoraleOutput {
  score: number | null
  label: MoraleLabel | null
  contesto_sociale: string | null
  comprensione_destinatari: string | null
  impatto_cascata: number
  intenzione: "benevola" | "malevola" | "neutra"
  trasparenza: number
  fiducia_risultante: number
  reason: string | null
}

export interface MultiPlaneState {
  pianoA: AmmissibilitaState
  pianoB: ForzaQuantitativa
  pianoC: PotenzaInferenziale
  pianoD: DominanzaDecisionale | null
}

export type ProofChainKind = "strict" | "defeasible" | "mixed" | "unknown"

export interface AnnotatedPolicyVerdict {
  allow: boolean
  reason?: string
  proofArtifact?: unknown
}

export interface MultiPlaneAnnotation {
  conclusion: string
  state: MultiPlaneState
  rawClassification: AmmissibilitaState
  reason: string
  timestamp: number
  callID: string
  proofChainKind: ProofChainKind
  extensionMembership: { inCount: number; totalCount: number }
  valutazione: ValutazioneMultiAsse | null
  policyVerdict?: AnnotatedPolicyVerdict | null
}
