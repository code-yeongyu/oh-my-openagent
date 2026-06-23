const BASE_TAG_FACTOR_MAP: Record<string, Array<{ factor: string; bonus: number }>> = {
  "evidence:": [{ factor: "supporto_empirico", bonus: 0.15 }],
  "data:": [{ factor: "supporto_empirico", bonus: 0.15 }],
  "empirical:": [{ factor: "supporto_empirico", bonus: 0.15 }],
  "structural:": [{ factor: "compatibilita_strutturale", bonus: 0.15 }],
  "compatible:": [{ factor: "compatibilita_strutturale", bonus: 0.15 }],
  "framework:": [{ factor: "compatibilita_strutturale", bonus: 0.15 }],
  "explains:": [{ factor: "potenziale_esplicativo", bonus: 0.15 }],
  "causal:": [{ factor: "potenziale_esplicativo", bonus: 0.15 }],
  "mechanism:": [{ factor: "potenziale_esplicativo", bonus: 0.15 }],
  "testable:": [{ factor: "valore_verifica", bonus: 0.15 }],
  "verifiable:": [{ factor: "valore_verifica", bonus: 0.15 }],
  "measurable:": [{ factor: "valore_verifica", bonus: 0.15 }],
  "established:": [{ factor: "maturita", bonus: 0.15 }],
  "proven:": [{ factor: "maturita", bonus: 0.15 }],
  "mature:": [{ factor: "maturita", bonus: 0.15 }],
  "benefit:": [{ factor: "beneficio_potenziale", bonus: 0.15 }],
  "value:": [{ factor: "beneficio_potenziale", bonus: 0.15 }],
  "advantage:": [{ factor: "beneficio_potenziale", bonus: 0.15 }],
  "urgent:": [{ factor: "urgenza", bonus: 0.15 }],
  "critical:": [{ factor: "urgenza", bonus: 0.15 }],
  "time-sensitive:": [{ factor: "urgenza", bonus: 0.15 }],
  "costly:": [{ factor: "costo_verifica", bonus: 0.15 }],
  "expensive:": [{ factor: "costo_verifica", bonus: 0.15 }],
  "resource-intensive:": [{ factor: "costo_verifica", bonus: 0.15 }],
  "risk:": [{ factor: "rischio", bonus: 0.15 }],
  "danger:": [{ factor: "rischio", bonus: 0.15 }],
  "hazard:": [{ factor: "rischio", bonus: 0.15 }],
  "safety:": [{ factor: "supporto_empirico", bonus: 0.1 }, { factor: "rischio", bonus: -0.1 }],
  "protection:": [{ factor: "supporto_empirico", bonus: 0.1 }, { factor: "rischio", bonus: -0.1 }],
  "care:": [{ factor: "supporto_empirico", bonus: 0.1 }, { factor: "rischio", bonus: -0.1 }],
  "commercial:": [{ factor: "beneficio_potenziale", bonus: 0.1 }, { factor: "rischio", bonus: 0.1 }],
  "self-interest:": [{ factor: "beneficio_potenziale", bonus: 0.1 }, { factor: "rischio", bonus: 0.1 }],
  "legal:": [{ factor: "compatibilita_strutturale", bonus: 0.15 }],
  "regulatory:": [{ factor: "compatibilita_strutturale", bonus: 0.15 }],
  "compliance:": [{ factor: "compatibilita_strutturale", bonus: 0.15 }],
}

const TAG_FACTOR_MAP: Record<string, Array<{ factor: string; bonus: number }>> = {
  ...BASE_TAG_FACTOR_MAP,
  ...Object.fromEntries(
    Object.entries(BASE_TAG_FACTOR_MAP).map(([prefix, mappings]) => [`@${prefix}`, mappings]),
  ),
  "contam:": [
    { factor: "supporto_empirico", bonus: -0.15 },
    { factor: "rischio", bonus: 0.15 },
  ],
  "@contam:": [
    { factor: "supporto_empirico", bonus: -0.15 },
    { factor: "rischio", bonus: 0.15 },
  ],
  "valence:benefit:": [{ factor: "supporto_empirico", bonus: 0.15 }],
  "@valence:benefit:": [{ factor: "supporto_empirico", bonus: 0.15 }],
  "valence:harm:": [
    { factor: "supporto_empirico", bonus: -0.15 },
    { factor: "rischio", bonus: 0.1 },
  ],
  "@valence:harm:": [
    { factor: "supporto_empirico", bonus: -0.15 },
    { factor: "rischio", bonus: 0.1 },
  ],
  "value:": [],
  "@value:": [],
}

const MAX_BONUS_PER_FACTOR = 0.3

export interface SemanticBonuses {
  supporto_empirico: number
  compatibilita_strutturale: number
  potenziale_esplicativo: number
  valore_verifica: number
  maturita: number
  beneficio_potenziale: number
  urgenza: number
  costo_verifica: number
  rischio: number
}

function createEmptyBonuses(): SemanticBonuses {
  return {
    supporto_empirico: 0,
    compatibilita_strutturale: 0,
    potenziale_esplicativo: 0,
    valore_verifica: 0,
    maturita: 0,
    beneficio_potenziale: 0,
    urgenza: 0,
    costo_verifica: 0,
    rischio: 0,
  }
}

function clampBonus(value: number): number {
  return Math.max(-MAX_BONUS_PER_FACTOR, Math.min(MAX_BONUS_PER_FACTOR, value))
}

export function analyzeTagSemantics(tags: string[]): SemanticBonuses {
  const bonuses = createEmptyBonuses()

  for (const tag of tags) {
    const normalizedTag = tag.toLowerCase()

    for (const [prefix, mappings] of Object.entries(TAG_FACTOR_MAP)) {
      if (!normalizedTag.startsWith(prefix)) {
        continue
      }

      for (const { factor, bonus } of mappings) {
        const key = factor as keyof SemanticBonuses
        bonuses[key] = clampBonus(bonuses[key] + bonus)
      }
    }
  }

  return bonuses
}
