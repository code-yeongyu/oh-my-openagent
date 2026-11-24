type Rule = {
  readonly key: string
  readonly set: string
  readonly pattern: string
}

// An offset is a state before a token; the final offset accepts. A star has
// both an any-character loop and a transition that consumes nothing.
function closure(pattern: string, offsets: Iterable<number>): readonly number[] {
  const result = new Set<number>()
  for (let offset of offsets) {
    result.add(offset)
    while (pattern[offset] === "*") result.add(++offset)
  }
  return [...result].sort((a, b) => a - b)
}

function advance(pattern: string, offsets: readonly number[], char: string | undefined): readonly number[] {
  const next: number[] = []
  for (const offset of offsets) {
    const token = pattern[offset]
    if (token === "*") next.push(offset)
    else if (token !== undefined && token === char) next.push(offset + 1)
  }
  return closure(pattern, next)
}

function matches(pattern: string, model: string): boolean {
  let offsets = closure(pattern, [0])
  for (let index = 0; index < model.length && offsets.length > 0; index++) {
    offsets = advance(pattern, offsets, model[index])
  }
  return offsets.includes(pattern.length)
}

// Explore the two automata together. If there is a string accepted by one
// pattern but not the other, that side is not a subset. All characters absent
// from both patterns have the same transitions, represented by undefined.
function strictSubset(left: string, right: string): boolean {
  if (left === right) return false
  const alphabet = new Set<string | undefined>([...(left + right).split(""), undefined])
  alphabet.delete("*")
  const queue: (readonly [readonly number[], readonly number[]])[] = []
  const seen = new Set<string>()
  const enqueue = (a: readonly number[], b: readonly number[]) => {
    if (a.length === 0 && b.length === 0) return
    const key = `${a.join(",")}/${b.join(",")}`
    if (seen.has(key)) return
    seen.add(key)
    queue.push([a, b])
  }
  enqueue(closure(left, [0]), closure(right, [0]))

  let rightHasExtra = false
  for (const [a, b] of queue) {
    const acceptsLeft = a.includes(left.length)
    const acceptsRight = b.includes(right.length)
    if (acceptsLeft && !acceptsRight) return false
    rightHasExtra ||= acceptsRight && !acceptsLeft
    for (const char of alphabet) {
      enqueue(advance(left, a, char), advance(right, b, char))
    }
  }
  return rightHasExtra
}

export function wildcardNicknameSet(models: Readonly<Record<string, string>>, modelId: string): string | undefined {
  const model = modelId.toLowerCase()
  const matching: Rule[] = []
  for (const [key, set] of Object.entries(models)) {
    if (!key.includes("*")) continue
    // Like the model denylist, model-only patterns can match across providers.
    const selector = key.trim().toLowerCase()
    const pattern = (selector.includes("/") ? selector : `*/${selector}`).replace(/\*+/g, "*")
    if (matches(pattern, model)) matching.push({ key, set, pattern })
  }

  // Only compare keys after removing every strict superset. Sorting by a
  // specificity comparator would be invalid: containment is a partial order.
  return matching
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .find((rule) => !matching.some((other) => strictSubset(other.pattern, rule.pattern)))?.set
}
