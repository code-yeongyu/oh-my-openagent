// Transcript-mention index for the kibitzer recall channel.
//
// Candidate collection runs on the main thread at EVERY prompt and EVERY tool_call. The original
// shape - `JSON.stringify(entries.slice(-200))` once, then one `RegExp.test` per corpus document
// over that whole string - costs O(window bytes x corpus size) per trigger (167-188ms at 817
// documents x 1.47MB, issue #8335). Branch history is append-only, so the same window is re-scanned
// from scratch for one or two new entries.
//
// This index keeps the exclusion set incremental: mentions are computed per ENTRY, cached by the
// entry's id, and the exclusion set is the union over the window. A trigger therefore pays only for
// the entries it has not seen yet.
//
// EQUIVALENCE with the whole-window scan (why per-entry matching cannot change the result):
//  1. `JSON.stringify(window)` is exactly `[` + entryJson[0] + `,` + entryJson[1] + ... + `]`, and
//     each entryJson is the same string this index tests. A match that is NOT contained in a single
//     entryJson would have to cover one of the array's own separator characters, so the path literal
//     itself would have to contain `[{`, `},`, `,{` or `}]`. Memory corpus paths never do; the rare
//     path that does falls back to the whole-window scan below, so the result stays exact either way.
//  2. The lookahead differs only at an entry's last character. In the array form the character after
//     entryJson[i] is `,` (or `]` for the last entry), both members of the delimiter class; in the
//     per-entry form the same position is end-of-string, which the `$` alternative accepts. Every
//     other position has identical following characters in both forms.
//  3. The NEWEST entry of the branch is never cached: the hook can fire while the newest message is
//     still streaming, so its JSON may grow between triggers. It is recomputed on every call, and it
//     becomes cacheable only once a later entry exists behind it.

/** Raw-entry window the exclusion scan covers (tool calls and results included). */
export const RECALL_PATH_ENTRY_WINDOW = 200

/** Sessions kept in the per-entry cache; a shared host interleaves a handful at most. */
const MAX_TRACKED_SESSIONS = 8

/** Array separators of the serialized window. A path containing one could straddle two entries. */
const ARRAY_SEAMS = ["[{", "},", ",{", "}]"] as const

/** Minimal corpus projection the index needs; `RecallDocument` satisfies it structurally. */
export interface MentionDocument {
  readonly path: string
}

export interface TranscriptMentionInput {
  readonly sessionId: string
  /** The full branch; the window is applied here so "newest entry" is unambiguous. */
  readonly entries: readonly unknown[]
  /** The corpus documents, reused by reference while HEAD has not moved. */
  readonly documents: readonly MentionDocument[]
}

export interface TranscriptMentionIndex {
  /** Corpus paths mentioned anywhere in the last RECALL_PATH_ENTRY_WINDOW branch entries. */
  excludedPaths(input: TranscriptMentionInput): Set<string>
}

interface MentionMatcher {
  readonly path: string
  readonly pattern: RegExp
}

interface MatcherSet {
  readonly documents: readonly MentionDocument[]
  readonly matchers: readonly MentionMatcher[]
  /** False when any path could straddle the array seam, which forces the whole-window scan. */
  readonly perEntrySafe: boolean
}

interface SessionMentions {
  documents: readonly MentionDocument[] | undefined
  readonly byEntryId: Map<string, ReadonlySet<string>>
}

/** The exact matcher the whole-window scan used before this index existed. */
function mentionMatcher(path: string): MentionMatcher {
  const escaped = JSON.stringify(path).slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // Close at transcript delimiters (including JSON-escaped whitespace), not filename suffixes.
  return { path, pattern: new RegExp(`${escaped}(?=$|[\\s"'\x60\\])}>:;,!?]|\\\\["nrtbf])`) }
}

function buildMatcherSet(documents: readonly MentionDocument[]): MatcherSet {
  const matchers = documents.map((document) => mentionMatcher(document.path))
  const perEntrySafe = documents.every((document) => !ARRAY_SEAMS.some((seam) => document.path.includes(seam)))
  return { documents, matchers, perEntrySafe }
}

function mentionsIn(json: string, matchers: readonly MentionMatcher[]): Set<string> {
  const mentions = new Set<string>()
  for (const matcher of matchers) {
    if (matcher.pattern.test(json)) mentions.add(matcher.path)
  }
  return mentions
}

/**
 * The pre-index behaviour, kept as the fallback for seam-unsafe corpora and as the differential
 * oracle in tests: one serialized window, one RegExp.test per document.
 */
export function excludedPathsByWindowScan(
  window: readonly unknown[],
  documents: readonly MentionDocument[],
): Set<string> {
  return mentionsIn(JSON.stringify(window), buildMatcherSet(documents).matchers)
}

function entryId(entry: unknown): string | undefined {
  if (entry === null || typeof entry !== "object") return undefined
  const id = (entry as { id?: unknown }).id
  return typeof id === "string" && id.length > 0 ? id : undefined
}

class BranchMentionIndex implements TranscriptMentionIndex {
  private matcherSet: MatcherSet | undefined
  private readonly sessions = new Map<string, SessionMentions>()

  excludedPaths(input: TranscriptMentionInput): Set<string> {
    const matcherSet = this.matchersFor(input.documents)
    const window = input.entries.slice(-RECALL_PATH_ENTRY_WINDOW)
    if (!matcherSet.perEntrySafe) return mentionsIn(JSON.stringify(window), matcherSet.matchers)

    const session = this.sessionFor(input.sessionId, input.documents)
    const excluded = new Set<string>()
    const live = new Set<string>()
    for (let index = 0; index < window.length; index += 1) {
      const entry = window[index]
      const id = index === window.length - 1 ? undefined : entryId(entry)
      if (id === undefined) {
        for (const path of mentionsIn(JSON.stringify(entry) ?? "", matcherSet.matchers)) excluded.add(path)
        continue
      }
      let mentions = session.byEntryId.get(id)
      if (mentions === undefined) {
        mentions = mentionsIn(JSON.stringify(entry) ?? "", matcherSet.matchers)
        session.byEntryId.set(id, mentions)
      }
      live.add(id)
      for (const path of mentions) excluded.add(path)
    }

    for (const id of [...session.byEntryId.keys()]) {
      if (!live.has(id)) session.byEntryId.delete(id)
    }
    return excluded
  }

  private matchersFor(documents: readonly MentionDocument[]): MatcherSet {
    if (this.matcherSet?.documents === documents) return this.matcherSet
    const matcherSet = buildMatcherSet(documents)
    this.matcherSet = matcherSet
    return matcherSet
  }

  private sessionFor(sessionId: string, documents: readonly MentionDocument[]): SessionMentions {
    const existing = this.sessions.get(sessionId)
    const session = existing ?? { documents: undefined, byEntryId: new Map<string, ReadonlySet<string>>() }
    // A moved HEAD can retire, add or rename paths, so cached per-entry sets no longer describe the
    // corpus; the whole session cache is dropped rather than reconciled.
    if (session.documents !== documents) {
      session.byEntryId.clear()
      session.documents = documents
    }
    if (existing !== undefined) this.sessions.delete(sessionId)
    this.sessions.set(sessionId, session)
    while (this.sessions.size > MAX_TRACKED_SESSIONS) {
      const oldest = this.sessions.keys().next()
      if (oldest.done === true) break
      this.sessions.delete(oldest.value)
    }
    return session
  }
}

export function createTranscriptMentionIndex(): TranscriptMentionIndex {
  return new BranchMentionIndex()
}
