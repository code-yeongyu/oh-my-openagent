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
  /** The path as it appears inside a JSON string. */
  readonly needle: string
}

interface MatcherSet {
  readonly documents: readonly MentionDocument[]
  readonly paths: ReadonlySet<string>
  readonly matchers: readonly MentionMatcher[]
  /** False when any path could straddle the array seam, which forces the whole-window scan. */
  readonly perEntrySafe: boolean
}

interface SessionMentions {
  documents: readonly MentionDocument[] | undefined
  readonly byEntryId: Map<string, ReadonlySet<string>>
}

/** The transcript delimiters a mention may end at (JSON-escaped whitespace and quotes included), not filename suffixes. */
const MENTION_END = /[\s"'\x60\])}>:;,!?]/
const JSON_ESCAPE_AFTER_BACKSLASH = /["nrtbf]/

function mentionMatcher(path: string): MentionMatcher {
  return { path, needle: JSON.stringify(path).slice(1, -1) }
}

/** `RegExp(\`${escaped}(?=$|[\s"'\x60\])}>:;,!?]|\\["nrtbf])\`).test(json)` without compiling one pattern per path. */
function mentions(json: string, needle: string): boolean {
  for (let at = json.indexOf(needle); at >= 0; at = json.indexOf(needle, at + 1)) {
    const end = at + needle.length
    if (end === json.length) return true
    const next = json[end] ?? ""
    if (MENTION_END.test(next)) return true
    if (next === "\\" && JSON_ESCAPE_AFTER_BACKSLASH.test(json[end + 1] ?? "")) return true
  }
  return false
}

function buildMatcherSet(documents: readonly MentionDocument[]): MatcherSet {
  const matchers = documents.map((document) => mentionMatcher(document.path))
  const perEntrySafe = documents.every((document) => !ARRAY_SEAMS.some((seam) => document.path.includes(seam)))
  return { documents, paths: new Set(documents.map((document) => document.path)), matchers, perEntrySafe }
}

function mentionsIn(json: string, matchers: readonly MentionMatcher[]): Set<string> {
  const found = new Set<string>()
  for (const matcher of matchers) {
    if (mentions(json, matcher.needle)) found.add(matcher.path)
  }
  return found
}

/**
 * The pre-index behaviour, kept as the differential oracle in tests: one serialized window, one
 * RegExp.test per document.
 */
export function excludedPathsByWindowScan(
  window: readonly unknown[],
  documents: readonly MentionDocument[],
): Set<string> {
  const json = JSON.stringify(window)
  const found = new Set<string>()
  for (const document of documents) {
    const escaped = JSON.stringify(document.path).slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    if (new RegExp(`${escaped}(?=$|[\\s"'\x60\\])}>:;,!?]|\\\\["nrtbf])`).test(json)) found.add(document.path)
  }
  return found
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

    const { session, added } = this.sessionFor(input.sessionId, matcherSet)
    const excluded = new Set<string>()
    const live = new Set<string>()
    for (let index = 0; index < window.length; index += 1) {
      const entry = window[index]
      const id = index === window.length - 1 ? undefined : entryId(entry)
      if (id === undefined) {
        for (const path of mentionsIn(JSON.stringify(entry) ?? "", matcherSet.matchers)) excluded.add(path)
        continue
      }
      let found = session.byEntryId.get(id)
      if (found === undefined) {
        found = mentionsIn(JSON.stringify(entry) ?? "", matcherSet.matchers)
      } else if (added.length > 0) {
        found = new Set([...found, ...mentionsIn(JSON.stringify(entry) ?? "", added)])
      }
      session.byEntryId.set(id, found)
      live.add(id)
      for (const path of found) excluded.add(path)
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

  /** The session's cache, carried to this corpus, and the corpus paths its cached sets have not been tested for. */
  private sessionFor(
    sessionId: string,
    matcherSet: MatcherSet,
  ): { readonly session: SessionMentions; readonly added: readonly MentionMatcher[] } {
    const existing = this.sessions.get(sessionId)
    const session = existing ?? { documents: undefined, byEntryId: new Map<string, ReadonlySet<string>>() }
    let added: readonly MentionMatcher[] = []
    if (session.documents !== matcherSet.documents) {
      added = this.reconcile(session, matcherSet)
      session.documents = matcherSet.documents
    }
    if (existing !== undefined) this.sessions.delete(sessionId)
    this.sessions.set(sessionId, session)
    while (this.sessions.size > MAX_TRACKED_SESSIONS) {
      const oldest = this.sessions.keys().next()
      if (oldest.done === true) break
      this.sessions.delete(oldest.value)
    }
    return { session, added }
  }

  /**
   * Carries the cached sets to a moved HEAD. A mention depends only on the entry and the path, so every
   * cached set stays exact for the paths both corpora share: removed paths leave it, and the paths the new
   * corpus added are returned for this same call to test against each cached entry still in the window.
   */
  private reconcile(session: SessionMentions, matcherSet: MatcherSet): readonly MentionMatcher[] {
    if (session.documents === undefined) return []
    const previous = new Set(session.documents.map((document) => document.path))
    for (const [id, found] of session.byEntryId) {
      const kept = [...found].filter((path) => matcherSet.paths.has(path))
      if (kept.length !== found.size) session.byEntryId.set(id, new Set(kept))
    }
    return matcherSet.matchers.filter((matcher) => !previous.has(matcher.path))
  }
}

export function createTranscriptMentionIndex(): TranscriptMentionIndex {
  return new BranchMentionIndex()
}
