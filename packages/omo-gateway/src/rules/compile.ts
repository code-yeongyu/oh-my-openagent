import { GATE_IDS, SESSION_UNIT_DEFAULTS, type GateId, type GateParams } from "./gates"
import { resolveRules, type ResolveTarget, type RuleCandidate } from "./resolve"

export interface CompiledRules {
  readonly version: string | null
  readonly behavioral: readonly string[]
  readonly gates: Readonly<Partial<Record<GateId, GateParams>>>
}

// `session_unit` is always in force: the router needs a unit for every platform, so the resolved
// keys are laid over the defaults. Gates are emitted in GATE_IDS order so the compiled set (and the
// prompt block rendered from it) is byte-stable for one version.
export function compileRules(
  candidates: readonly RuleCandidate[],
  target: ResolveTarget,
  version: string | null,
): CompiledRules {
  const resolved = resolveRules(candidates, target)
  const gates: Partial<Record<GateId, GateParams>> = {}
  for (const gate of GATE_IDS) {
    const params = resolved.gates.get(gate)?.params
    if (gate === "session_unit") {
      gates.session_unit = { ...SESSION_UNIT_DEFAULTS, ...params }
      continue
    }
    if (params !== undefined) gates[gate] = params
  }
  return {
    version,
    behavioral: resolved.behavioral.map(({ rule }) => rule.text),
    gates,
  }
}
