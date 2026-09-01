// Deterministic seeded PRNG for the chaos bench. No Date.now / Math.random anywhere: every draw
// derives from the captured seed so a pinned seed replays an identical interleaving.

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193
const U32 = 0x1_0000_0000

export function hashSeed(text: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

// Independent per-iteration sub-stream so pinning one iteration reproduces it in isolation.
export function deriveSeed(base: number, iteration: number): number {
  let mixed = (base ^ Math.imul(iteration + 1, 0x9e3779b1)) >>> 0
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b) >>> 0
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35) >>> 0
  return (mixed ^ (mixed >>> 16)) >>> 0
}

export type WeightedChoice<T> = { readonly value: T; readonly weight: number }

export class RandomSource {
  #state: number

  constructor(seed: number) {
    this.#state = seed >>> 0
  }

  float(): number {
    this.#state = (this.#state + 0x6d2b79f5) | 0
    let t = Math.imul(this.#state ^ (this.#state >>> 15), 1 | this.#state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / U32
  }

  int(minInclusive: number, maxInclusive: number): number {
    const span = maxInclusive - minInclusive + 1
    return minInclusive + Math.floor(this.float() * span)
  }

  bool(probabilityTrue = 0.5): boolean {
    return this.float() < probabilityTrue
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("RandomSource.pick on an empty array")
    return items[this.int(0, items.length - 1)] as T
  }

  weighted<T>(choices: readonly WeightedChoice<T>[]): T {
    const total = choices.reduce((sum, choice) => sum + choice.weight, 0)
    let threshold = this.float() * total
    for (const choice of choices) {
      threshold -= choice.weight
      if (threshold < 0) return choice.value
    }
    return choices[choices.length - 1]?.value as T
  }
}
