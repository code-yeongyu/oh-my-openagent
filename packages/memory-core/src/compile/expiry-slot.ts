import { isMemoryExpired } from "../memfs/expiry"
import type { MemoryExpiry } from "./compile"

/**
 * The part of the clock a compiled block depends on: which of its revision's `expires` instants have passed. Two
 * instants with the same slot compile to the same bytes, so a block is cached per (revision, slot).
 */
export function expirySlot(expiries: readonly MemoryExpiry[], asOfMs: number): string {
  return expiries
    .filter((expiry) => isMemoryExpired(expiry.expiresAtMs, asOfMs))
    .map((expiry) => `${expiry.path}@${expiry.expiresAtMs}`)
    .sort()
    .join("|")
}
