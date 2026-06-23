import { FormalizationError } from "./errors"
import { findPreferenceGroupViolation } from "./preference-group-check"
import type { Theory } from "./types"
import { findInvalidValueTagFormula } from "./value-tag-format-check"

type Logger = { warn(msg: string, meta?: Record<string, unknown>): void }

const VALID_PREMISE_KINDS = new Set(["axiom", "ordinary", "assumption"])

export type TheoryValidatorDeps = {
  logger: Logger
  expectedOptionAtoms?: string[]
}

export type TheoryValidator = {
  validate(theory: Theory, expectedOptionAtoms?: string[]): Theory
}

type Rule = NonNullable<Theory["strict_rules"]>[number]

function throwTheoryInvalid(logger: Logger, details: Record<string, unknown>): never {
  logger.warn("theory-validator: theory failed well-formedness validation", details)

  throw new FormalizationError({
    code: "theory_invalid",
    details,
  })
}

function collectAllRules(theory: Theory): Rule[] {
  return [...(theory.strict_rules ?? []), ...(theory.defeasible_rules ?? [])]
}

function collectKnownFormulas(theory: Theory, allRules: Rule[]): Set<string> {
  return new Set<string>([
    ...theory.premises.map((premise) => premise.formula),
    ...allRules.map((rule) => rule.consequent),
  ])
}

function collectPairwisePreferences(theory: Theory): Array<{ superior: string; inferior: string }> {
  if (!theory.preferences) {
    return []
  }

  if (Array.isArray(theory.preferences)) {
    return theory.preferences
  }

  return theory.preferences.pairwise ?? []
}

function overlapsClassicalNegation(left: string, right: string): boolean {
  return left.startsWith("-") ? left.slice(1) === right : right.startsWith("-") && right.slice(1) === left
}

function validateContraries(theory: Theory, knownFormulas: Set<string>, logger: Logger) {
  for (const [left, right] of theory.contraries ?? []) {
    if (left === right) {
      throwTheoryInvalid(logger, {
        violation: "self_contrary",
        contrary: [left, right],
      })
    }

    if (theory.classical_negation && overlapsClassicalNegation(left, right)) {
      throwTheoryInvalid(logger, {
        violation: "contrary_overlaps_classical_negation",
        contrary: [left, right],
      })
    }

    if (!knownFormulas.has(left) || !knownFormulas.has(right)) {
      throwTheoryInvalid(logger, {
        violation: "invalid_contrary_references",
        contrary: [left, right],
      })
    }
  }
}

export function createTheoryValidator(deps: TheoryValidatorDeps): TheoryValidator {
  const { logger, expectedOptionAtoms: defaultExpectedOptionAtoms } = deps

  return {
    validate(theory: Theory, expectedOptionAtoms?: string[]): Theory {
      const allRules = collectAllRules(theory)

      for (const premise of theory.premises) {
        if (premise.kind && !VALID_PREMISE_KINDS.has(premise.kind)) {
          throwTheoryInvalid(logger, {
            violation: "invalid_premise_kind",
            formula: premise.formula,
            kind: premise.kind,
          })
        }

        if (premise.formula.trim().length === 0) {
          throwTheoryInvalid(logger, {
            violation: "non_atomic_premises",
            formula: premise.formula,
          })
        }
      }

      const invalidValueTagFormula = findInvalidValueTagFormula([
        ...theory.premises.map((premise) => premise.formula),
        ...allRules.flatMap((rule) => [...rule.antecedents, rule.consequent]),
      ])
      if (invalidValueTagFormula) {
        throwTheoryInvalid(logger, {
          violation: "invalid_value_tag_format",
          formula: invalidValueTagFormula,
        })
      }

      const knownFormulas = collectKnownFormulas(theory, allRules)
      const seenRuleIds = new Set<string>()

      for (const rule of allRules) {
        if (seenRuleIds.has(rule.id)) {
          throwTheoryInvalid(logger, {
            violation: "duplicate_rule_ids",
            rule_id: rule.id,
          })
        }

        seenRuleIds.add(rule.id)
      }

      for (const rule of allRules) {
        for (const antecedent of rule.antecedents) {
          const negationStrippedAntecedent = antecedent.startsWith("-")
            ? antecedent.slice(1)
            : antecedent

          if (
            !knownFormulas.has(antecedent) &&
            !knownFormulas.has(negationStrippedAntecedent)
          ) {
            throwTheoryInvalid(logger, {
              violation: "dangling_antecedents",
              rule_id: rule.id,
              antecedent,
            })
          }
        }
      }

      for (const preference of collectPairwisePreferences(theory)) {
        if (!seenRuleIds.has(preference.superior) && !knownFormulas.has(preference.superior)) {
          throwTheoryInvalid(logger, {
            violation: "invalid_preference_references",
            preference,
          })
        }

        if (!seenRuleIds.has(preference.inferior) && !knownFormulas.has(preference.inferior)) {
          throwTheoryInvalid(logger, {
            violation: "invalid_preference_references",
            preference,
          })
        }
      }

      const preferenceGroupViolation = findPreferenceGroupViolation(theory, seenRuleIds, knownFormulas)
      if (preferenceGroupViolation) {
        throwTheoryInvalid(logger, preferenceGroupViolation)
      }

      validateContraries(theory, knownFormulas, logger)

      const requiredOptionAtoms = expectedOptionAtoms ?? defaultExpectedOptionAtoms ?? []
      if (requiredOptionAtoms.length > 0) {
        const consequents = new Set(allRules.map((rule) => rule.consequent))

        for (const optionAtom of requiredOptionAtoms) {
          if (!consequents.has(optionAtom)) {
            throwTheoryInvalid(logger, {
              violation: "unreachable_option_atoms",
              option_atom: optionAtom,
            })
          }
        }
      }

      return theory
    },
  }
}
