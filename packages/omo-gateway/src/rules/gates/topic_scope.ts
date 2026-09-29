import { OK, optionalStringParam, stringListParam, type OutboundGate } from "./types"
import { textsOf } from "./text"

function termPattern(term: string): RegExp {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu")
}

// Mechanical half of the scope rule: refuses text naming a denied term (other organizations,
// private matters); the behavioral rule next to it carries the judgement a term list cannot.
export const gate: OutboundGate = {
  id: "topic_scope",
  phase: "outbound",
  run(intent, params) {
    const deny = stringListParam(params, "deny", []).filter((term) => term.trim().length > 0)
    const redirect = optionalStringParam(params, "redirect")
    for (const text of textsOf(intent)) {
      const hit = deny.find((term) => termPattern(term).test(text))
      if (hit !== undefined) {
        const where = redirect === null ? "" : `; take it to ${redirect}`
        return { refuse: `'${hit}' is outside this scope's topics${where}` }
      }
    }
    return OK
  },
}
