import { selectWeakestPremise } from "./premise-strength-ranker"

type Premise = { formula: string; kind?: string }
type StrictRule = { id: string; antecedents: string[]; consequent: string }
type DefeasibleRule = { id: string; antecedents: string[]; consequent: string }
type Preference = { superior: string; inferior: string }
type FailingVerdict = "unable_to_converge" | "no_selectable_bundle"

export interface AgmRevisionTheory {
  premises: Premise[]
  strict_rules: StrictRule[]
  defeasible_rules: DefeasibleRule[]
  preferences: Preference[]
  classical_negation: boolean
}

export async function runAgmBeliefRevisionProtocol<T extends { verdict: string }>(input: {
  theory: AgmRevisionTheory
  failingVerdict: FailingVerdict
  reRun: (theory: AgmRevisionTheory) => Promise<T>
  maxCycles?: number
}): Promise<null | (Omit<T, "verdict"> & {
  verdict: "converged_after_revision"
  revised_premises: string[]
  revised_theory: AgmRevisionTheory
})> {
  const maxCycles = input.maxCycles ?? 3
  let theory = cloneTheory(input.theory)
  const revisedPremises: string[] = []

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    const weakestPremise = selectWeakestPremise(theory.premises)
    if (!weakestPremise) {
      return null
    }

    revisedPremises.push(weakestPremise.premise.formula)
    theory = {
      ...theory,
      premises: theory.premises.filter((_, index) => index !== weakestPremise.index),
    }

    const rerunResult = await input.reRun(cloneTheory(theory))
    if (rerunResult.verdict !== input.failingVerdict) {
      return {
        ...rerunResult,
        verdict: "converged_after_revision",
        revised_premises: [...revisedPremises],
        revised_theory: cloneTheory(theory),
      }
    }
  }

  return null
}

function cloneTheory(theory: AgmRevisionTheory): AgmRevisionTheory {
  return {
    ...theory,
    premises: theory.premises.map((premise) => ({ ...premise })),
    strict_rules: theory.strict_rules.map((rule) => ({ ...rule, antecedents: [...rule.antecedents] })),
    defeasible_rules: theory.defeasible_rules.map((rule) => ({ ...rule, antecedents: [...rule.antecedents] })),
    preferences: theory.preferences.map((preference) => ({ ...preference })),
  }
}
