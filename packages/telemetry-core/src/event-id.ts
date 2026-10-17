import { randomBytes as nodeRandomBytes } from "node:crypto"

export type UuidV7Source = {
  readonly now?: () => number
  readonly randomBytes?: (size: number) => Uint8Array
}

const MAX_COUNTER = 0xfff
// A fresh millisecond seeds the 12-bit counter in its lower half, so a burst inside that millisecond
// still has at least 2048 increments before the timestamp has to advance.
const COUNTER_SEED_MASK = 0x7ff

/**
 * A monotonic UUIDv7 generator (RFC 9562, section 6.2 method 1): 48-bit unix milliseconds, then a
 * 12-bit counter in `rand_a`, then 62 random bits. Ids from one generator sort in creation order even
 * inside one millisecond and when the wall clock steps backwards.
 */
export function createUuidV7Generator(source: UuidV7Source = {}): () => string {
  const now = source.now ?? Date.now
  const randomBytes = source.randomBytes ?? ((size: number) => new Uint8Array(nodeRandomBytes(size)))
  let lastMs = -1
  let counter = 0

  return () => {
    const random = randomBytes(10)
    const wallMs = Math.floor(now())
    if (wallMs > lastMs) {
      lastMs = wallMs
      counter = ((random[0]! << 8) | random[1]!) & COUNTER_SEED_MASK
    } else if (counter < MAX_COUNTER) {
      counter += 1
    } else {
      lastMs += 1
      counter = ((random[0]! << 8) | random[1]!) & COUNTER_SEED_MASK
    }

    const bytes = new Uint8Array(16)
    let timestamp = lastMs
    for (let index = 5; index >= 0; index -= 1) {
      bytes[index] = timestamp % 256
      timestamp = Math.floor(timestamp / 256)
    }
    bytes[6] = 0x70 | (counter >> 8)
    bytes[7] = counter & 0xff
    bytes[8] = 0x80 | (random[2]! & 0x3f)
    bytes.set(random.subarray(3, 10), 9)
    return formatUuid(bytes)
  }
}

const fallbackEventId = createUuidV7Generator()

export function createEventId(): string {
  return typeof Bun !== "undefined" && typeof Bun.randomUUIDv7 === "function"
    ? Bun.randomUUIDv7()
    : fallbackEventId()
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
