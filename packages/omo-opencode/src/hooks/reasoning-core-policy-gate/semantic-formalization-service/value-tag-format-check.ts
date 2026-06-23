const VALID_VALUE_TAGGED_FORMULA = /^(?:.+\s)?@value:[a-z_]+$/

export function findInvalidValueTagFormula(formulas: string[]): string | null {
  for (const formula of formulas) {
    if (!formula.includes("@value:")) {
      continue
    }

    if (!VALID_VALUE_TAGGED_FORMULA.test(formula)) {
      return formula
    }
  }

  return null
}
