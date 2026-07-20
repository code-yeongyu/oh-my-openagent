export type NameRegistration = {
  readonly name: string
  readonly warning?: string
}

// Unique-per-parent name registry. A collision keeps the requested stem and appends the lowest free
// numeric suffix (-2, -3, ...), returning a warning so the caller can surface the rename.
export class NameRegistry {
  readonly #byParent = new Map<string, Set<string>>()

  register(parentSessionId: string, requested: string | undefined, fallback?: string): NameRegistration {
    const taken = this.#byParent.get(parentSessionId) ?? new Set<string>()
    this.#byParent.set(parentSessionId, taken)

    const desired = normalize(requested) ?? normalize(fallback) ?? `task-${taken.size + 1}`
    if (!taken.has(desired)) {
      taken.add(desired)
      return { name: desired }
    }

    let suffix = 2
    while (taken.has(`${desired}-${suffix}`)) suffix += 1
    const resolved = `${desired}-${suffix}`
    taken.add(resolved)
    return { name: resolved, warning: `Task name "${desired}" already exists in this session; using "${resolved}".` }
  }

  release(parentSessionId: string, name: string): void {
    this.#byParent.get(parentSessionId)?.delete(name)
  }
}

function normalize(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}
