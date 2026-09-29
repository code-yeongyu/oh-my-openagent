import { GateParamsError, OK, stringListParam, type OutboundGate } from "./types"
import { describeScript, letters, proseOf, sampleAround, scriptsForLanguage, textsOf, type ScriptName } from "./text"

// Latin letters are always tolerated: identifiers, product names and URLs appear in every language.
function allowedScripts(tags: readonly string[]): ReadonlySet<ScriptName> {
  const scripts = new Set<ScriptName>(["Latin"])
  for (const tag of tags) {
    const known = scriptsForLanguage(tag)
    if (known === null) throw new GateParamsError(`unknown language tag '${tag}' in params.allow`)
    for (const script of known) scripts.add(script)
  }
  return scripts
}

export const gate: OutboundGate = {
  id: "language",
  phase: "outbound",
  run(intent, params) {
    const allow = stringListParam(params, "allow", [])
    if (allow.length === 0) throw new GateParamsError("params.allow must name at least one language")
    const scripts = allowedScripts(allow)
    for (const markup of textsOf(intent)) {
      const prose = proseOf(markup)
      const outside = letters(prose).find((hit) => !scripts.has(hit.script))
      if (outside !== undefined) {
        return {
          refuse: `this chat allows only ${allow.join(", ")}; the text contains ${describeScript(outside.script)} near "${sampleAround(prose, outside.index)}"`,
        }
      }
    }
    return OK
  },
}
