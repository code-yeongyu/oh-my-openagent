import { isMemoryExpired } from "../memfs/expiry"
import type { CleanupCorpus } from "./corpus"
import { retirementTokenOf } from "./text"
import type { CleanupEvidence } from "./types"

export interface StaleCandidate {
  readonly subject: string
  readonly evidence: readonly CleanupEvidence[]
}

/**
 * Stale means the note itself says so: its `expires` instant has passed, or its file name carries a retirement
 * token. Age alone is never evidence; an old fact that is still true stays.
 */
export function findStale(corpus: CleanupCorpus, now: number): StaleCandidate[] {
  const candidates: StaleCandidate[] = []
  for (const note of corpus.notes.values()) {
    const evidence: CleanupEvidence[] = []
    if (isMemoryExpired(note.expiresAtMs, now)) {
      evidence.push({
        kind: "expired",
        detail: `expires: ${note.frontmatter.extra?.expires ?? ""} passed (now ${new Date(now).toISOString()})`,
        at: `${note.path}:expires`,
      })
    }
    const token = retirementTokenOf(note.path)
    if (token !== undefined) evidence.push({ kind: "retired-name", detail: `file name carries -${token}` })
    if (evidence.length > 0) candidates.push({ subject: note.path, evidence })
  }
  return candidates.sort((a, b) => a.subject.localeCompare(b.subject))
}
