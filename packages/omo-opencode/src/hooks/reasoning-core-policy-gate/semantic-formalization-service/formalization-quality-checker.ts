import type { FormalizationRequest, Theory } from "./types"

export type FormalizationQualityReport = {
  isAcceptable: boolean
  duplicateSelectionRuleSets: string[]
  missingOptionHarmCoverage: string[]
  missingOptionTags: string[]
  taggedSelectionAtoms: string[]
  missingValueTags: string[]
  qualityWarnings: string[]
}

export type FormalizationQualityChecker = {
  check(input: { request: FormalizationRequest; theory: Theory; expectedOptionAtoms?: string[] }): FormalizationQualityReport
}

const HARM_KEYWORDS = [
  "harm",
  "risk",
  "death",
  "mortality",
  "coerc",
  "force",
  "sedation",
  "restraint",
  "intrusion",
  "burden",
  "loss",
  "severe",
]

const ABSTRACT_VALUE_DIMENSIONS = [
  "safety",
  "autonomy",
  "transparency",
  "cost_efficiency",
  "precedent_integrity",
  "beneficence",
  "justice",
  "dignity",
  "vita_umana",
]

const SELECTION_ATOM_TAG_PATTERN = /^-?select_option_[a-z0-9_]+\s+@(option|value|valence|risk):/i

export function createFormalizationQualityChecker(): FormalizationQualityChecker {
  return {
    check({ request, theory, expectedOptionAtoms = [] }) {
      const duplicateSelectionRuleSets = findDuplicateSelectionRuleSets(theory, expectedOptionAtoms)
      const missingOptionHarmCoverage = findMissingOptionHarmCoverage(request, theory, expectedOptionAtoms)
      const missingOptionTags = findMissingOptionTags(theory, expectedOptionAtoms)
      const taggedSelectionAtoms = findTaggedSelectionAtoms(theory, expectedOptionAtoms)
      const missingValueTags = findMissingValueTags(request, theory)

      const qualityWarnings = [
        ...duplicateSelectionRuleSets.map((pair) => `Duplicate selection support detected: ${pair}`),
        ...missingOptionHarmCoverage.map((optionAtom) => `Missing explicit harm coverage for ${optionAtom}`),
        ...missingOptionTags.map((optionAtom) => {
          const candidates = deriveOptionIdCandidates(optionAtom, expectedOptionAtoms.indexOf(optionAtom))
          return `Missing @option:${candidates[0]} tag (also accepts @option:${candidates[1]}) in premises or rule consequents for ${optionAtom} (Rule 2/6)`
        }),
        ...taggedSelectionAtoms.map((atom) => `Forbidden tag appended to bare selection atom: ${atom} (Rule 7)`),
        ...missingValueTags.map((value) => `Missing value tag @value:${value} — request preferences reference this value dimension (Rule 6 mandate)`),
      ]

      return {
        isAcceptable:
          duplicateSelectionRuleSets.length === 0 &&
          missingOptionHarmCoverage.length === 0 &&
          missingOptionTags.length === 0 &&
          taggedSelectionAtoms.length === 0 &&
          missingValueTags.length === 0,
        duplicateSelectionRuleSets,
        missingOptionHarmCoverage,
        missingOptionTags,
        taggedSelectionAtoms,
        missingValueTags,
        qualityWarnings,
      }
    },
  }
}

function findDuplicateSelectionRuleSets(theory: Theory, expectedOptionAtoms: string[]): string[] {
  const selectionRules = (theory.defeasible_rules ?? []).filter((rule) => expectedOptionAtoms.includes(rule.consequent))
  const byAntecedentKey = new Map<string, string[]>()

  for (const rule of selectionRules) {
    const key = [...rule.antecedents].sort().join("||")
    const list = byAntecedentKey.get(key) ?? []
    list.push(rule.consequent)
    byAntecedentKey.set(key, list)
  }

  return [...byAntecedentKey.values()]
    .filter((consequents) => consequents.length > 1)
    .map((consequents) => consequents.sort().join(" ↔ "))
}

function findMissingOptionHarmCoverage(request: FormalizationRequest, theory: Theory, expectedOptionAtoms: string[]): string[] {
  const formulas = collectAllFormulas(theory)
  return request.options.flatMap((option, index) => {
    const optionAtom = expectedOptionAtoms[index]
    if (!optionAtom || !optionMentionsHarm(option)) return []

    const optionTag = `@option:option_${String.fromCharCode(97 + index)}`
    const hasHarmCoverage = formulas.some((formula) => formula.toLowerCase().includes(optionTag) && formula.includes("@valence:harm:"))
    return hasHarmCoverage ? [] : [optionAtom]
  })
}

function findMissingOptionTags(theory: Theory, expectedOptionAtoms: string[]): string[] {
  if (expectedOptionAtoms.length === 0) return []
  const formulas = collectAllFormulas(theory)
  return expectedOptionAtoms.filter((optionAtom, index) => {
    const candidates = deriveOptionIdCandidates(optionAtom, index)
    return !candidates.some((id) => formulas.some((formula) => formula.includes(`@option:${id}`)))
  })
}

function findTaggedSelectionAtoms(theory: Theory, expectedOptionAtoms: string[]): string[] {
  const allRules = [...(theory.strict_rules ?? []), ...(theory.defeasible_rules ?? [])]
  const flagged = new Set<string>()
  for (const rule of allRules) {
    if (SELECTION_ATOM_TAG_PATTERN.test(rule.consequent)) flagged.add(rule.consequent)
  }
  for (const atom of expectedOptionAtoms) {
    if (SELECTION_ATOM_TAG_PATTERN.test(atom)) flagged.add(atom)
  }
  return [...flagged]
}

function findMissingValueTags(request: FormalizationRequest, theory: Theory): string[] {
  const formulas = collectAllFormulas(theory)
  const hasValueTag = formulas.some((formula) => /@value:[a-z_]+/i.test(formula))
  const referencedValues = collectReferencedValues(request)
  if (referencedValues.length === 0) return []
  if (!hasValueTag) return referencedValues
  return referencedValues.filter((value) => !formulas.some((formula) => formula.toLowerCase().includes(`@value:${value}`)))
}

function collectReferencedValues(request: FormalizationRequest): string[] {
  const haystack = [
    ...request.preferences.flatMap((pref) => [pref.superior, pref.inferior]),
    request.problem_statement,
    ...(request.context ? [request.context] : []),
  ]
    .join(" ")
    .toLowerCase()
  return ABSTRACT_VALUE_DIMENSIONS.filter((value) => haystack.includes(value))
}

function collectAllFormulas(theory: Theory): string[] {
  return [
    ...theory.premises.map((premise) => premise.formula),
    ...(theory.strict_rules ?? []).flatMap((rule) => [...rule.antecedents, rule.consequent]),
    ...(theory.defeasible_rules ?? []).flatMap((rule) => [...rule.antecedents, rule.consequent]),
  ]
}

function deriveOptionIdCandidates(optionAtom: string, index: number): [string, string] {
  const stripped = optionAtom.startsWith("-") ? optionAtom.slice(1) : optionAtom
  const bare = stripped.split(/\s+/)[0] ?? stripped
  const match = bare.match(/^select_(.+)$/)
  const derived = match ? match[1] : bare
  const indexedLetter = `option_${String.fromCharCode(97 + Math.max(0, index))}`
  return [derived, indexedLetter]
}

function optionMentionsHarm(option: string): boolean {
  const lower = option.toLowerCase()
  return HARM_KEYWORDS.some((keyword) => lower.includes(keyword))
}
