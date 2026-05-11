import { FRUITS, VEGETABLES } from "./word-lists"

export interface GenerateNameOptions {
  /** Custom RNG returning a float in [0, 1). Defaults to Math.random. */
  random?: () => number
  /** When provided, appended after a hyphen as a numeric suffix (e.g. for collisions). */
  suffix?: number | string
}

function pick<T>(items: readonly T[], rand: () => number): T {
  const index = Math.floor(rand() * items.length)
  // Math.floor(1 * len) = len, which would be out of bounds; clamp.
  const safeIndex = Math.min(index, items.length - 1)
  return items[safeIndex] as T
}

/**
 * Generate a friendly session name like "strawberry-carrot".
 *
 * The first word is always a fruit, the second is always a vegetable, so the
 * order is predictable and the combo is easy to recognize at a glance.
 */
export function generateFriendlySessionName(options: GenerateNameOptions = {}): string {
  const rand = options.random ?? Math.random
  const fruit = pick(FRUITS, rand)
  const vegetable = pick(VEGETABLES, rand)
  const base = `${fruit}-${vegetable}`
  if (options.suffix === undefined || options.suffix === null) {
    return base
  }
  return `${base}-${options.suffix}`
}

/**
 * Total number of distinct base combos (no suffix). Useful for tests and
 * for sizing collision-suffix retries.
 */
export const FRIENDLY_SESSION_NAME_COMBO_COUNT = FRUITS.length * VEGETABLES.length
