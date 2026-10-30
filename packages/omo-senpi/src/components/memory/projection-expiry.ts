// Memory that expires after a session's pin (#11450). The pinned prompt keeps its bytes (#8470), so a block that
// was live at the pin instant stays in the prompt until the next repin; the model is told once, in the late
// <memory_notice>, that it no longer holds. Expiry instants are announced through a watermark kept in the pin record,
// so a resumed or restarted session does not announce the same instant again.

import type { MemoryExpiry } from "@oh-my-opencode/memory-core"

export const MEMORY_EXPIRED_METADATA_TOKEN = "Expired since this prompt was pinned"
const MAX_LISTED_PATHS = 20

/** Expiries that were live at the pin, passed by `nowMs`, and not yet announced. */
export function newlyExpired(
  expiries: readonly MemoryExpiry[],
  window: { readonly pinnedAtMs: number; readonly noticedThroughMs: number; readonly nowMs: number },
): MemoryExpiry[] {
  const after = Math.max(window.pinnedAtMs, window.noticedThroughMs)
  return expiries.filter((expiry) => expiry.expiresAtMs > after && expiry.expiresAtMs <= window.nowMs)
}

export function renderExpiredLine(expired: readonly MemoryExpiry[]): string {
  const hidden = expired.length - MAX_LISTED_PATHS
  const listed = expired.slice(0, MAX_LISTED_PATHS).map((expiry) => expiry.path).join(", ")
  return `- ${MEMORY_EXPIRED_METADATA_TOKEN} (no longer true): ${listed}${hidden > 0 ? `, ${hidden} more` : ""}.`
}
