/**
 * `exclude_models` matching. An entry with a `/` is matched against the whole `provider/model`; one
 * without is matched against the model id served by any provider. `*` matches any run of characters
 * (including none, and including `/`), and matching ignores case, so `claude-fable-*` keeps every
 * Fable build out whichever provider serves it. Blank entries match nothing.
 */

function patternExpression(pattern: string): RegExp {
  const escaped = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")
  return new RegExp(`^${escaped}$`, "i")
}

// A selector is `provider/modelId`, and a gateway's model id can itself be `vendor/model`
// (`openrouter/anthropic/claude-fable-5-1`). Every tail that starts after a `/` is a model id some
// provider serves, so an entry is tested against each of them; a `provider/model` entry may also
// match the whole selector.
function selectorTails(model: string): readonly string[] {
  const tails: string[] = []
  for (let index = model.indexOf("/"); index !== -1; index = model.indexOf("/", index + 1)) {
    tails.push(model.slice(index + 1))
  }
  return tails.length === 0 ? [model] : tails
}

export function excludedModelPattern(model: string, patterns: readonly string[] | undefined): string | undefined {
  if (patterns === undefined || patterns.length === 0) return undefined
  const tails = selectorTails(model)
  for (const raw of patterns) {
    const pattern = raw.trim()
    if (pattern.length === 0) continue
    const expression = patternExpression(pattern)
    const subjects = pattern.includes("/") ? [model, ...tails] : tails
    if (subjects.some((subject) => expression.test(subject))) return raw
  }
  return undefined
}

export function isExcludedModel(model: string, patterns: readonly string[] | undefined): boolean {
  return excludedModelPattern(model, patterns) !== undefined
}
