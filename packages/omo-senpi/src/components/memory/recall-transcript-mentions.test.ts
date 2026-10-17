import { describe, expect, test } from "bun:test"

import {
  RECALL_PATH_ENTRY_WINDOW,
  createTranscriptMentionIndex,
  excludedPathsByWindowScan,
} from "./recall-transcript-mentions"

const SESSION_ID = "session-mentions-1"
const CORPUS_SIZE = 800

interface Doc {
  readonly path: string
}

function corpusDocuments(): Doc[] {
  const documents: Doc[] = []
  for (let index = 0; index < CORPUS_SIZE; index += 1) {
    documents.push({ path: `reference/topic-${String(index).padStart(3, "0")}.md` })
  }
  // Prefix neighbour: `reference/topic-007.md` is a strict prefix of nothing, but this pair pins
  // that a longer path sharing a prefix with a mentioned one is not dragged in.
  documents.push({ path: "reference/topic-017.md.backup.md" })
  documents.push({ path: "notes/nested/deep-note.md" })
  return documents
}

function path(index: number): string {
  return `reference/topic-${String(index).padStart(3, "0")}.md`
}

function userEntry(id: string, text: string): Record<string, unknown> {
  return { type: "message", id, message: { role: "user", content: [{ type: "text", text }] } }
}

function assistantEntry(id: string, text: string): Record<string, unknown> {
  return { type: "message", id, message: { role: "assistant", content: [{ type: "text", text }] } }
}

function toolCallEntry(id: string, argumentPath: string): Record<string, unknown> {
  return {
    type: "message",
    id,
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: `call-${id}`, name: "read", arguments: { path: argumentPath } }],
    },
  }
}

function toolResultEntry(id: string, text: string): Record<string, unknown> {
  return {
    type: "message",
    id,
    message: {
      role: "toolResult",
      toolCallId: `call-${id}`,
      toolName: "read",
      content: [{ type: "text", text }],
    },
  }
}

const FILLER = "Continuing the investigation with enough prose to make the entry realistic. ".repeat(8)

/**
 * 250 entries whose planted mentions cover every delimiter shape the exclusion regex accepts,
 * plus false neighbours that must NOT be excluded.
 */
function branchEntries(): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = []
  for (let index = 0; index < 250; index += 1) {
    const id = `entry-${String(index).padStart(3, "0")}`
    if (index % 25 === 3) {
      // mid-entry mention followed by a space
      entries.push(assistantEntry(id, `${FILLER} I read ${path(index)} first, then moved on. ${FILLER}`))
      continue
    }
    if (index % 25 === 7) {
      // mention at the very end of the entry's last text block
      entries.push(userEntry(id, `${FILLER} check ${path(index)}`))
      continue
    }
    if (index % 25 === 11) {
      // JSON-escaped quote neighbour: the serialized entry carries \"path\"
      entries.push(assistantEntry(id, `${FILLER} the note "${path(index)}" says otherwise.`))
      continue
    }
    if (index % 25 === 13) {
      // JSON-escaped newline neighbour: the serialized entry carries path\nnext
      entries.push(assistantEntry(id, `${FILLER} see:\n${path(index)}\nnext line`))
      continue
    }
    if (index % 25 === 17) {
      // false neighbour: `.md.bak` must not exclude the `.md` document
      entries.push(assistantEntry(id, `${FILLER} opened ${path(index)}.bak instead. ${FILLER}`))
      continue
    }
    if (index % 25 === 19) {
      // mention inside tool call arguments, absolute form
      entries.push(toolCallEntry(id, `/memory/${path(index)}`))
      continue
    }
    if (index % 25 === 21) {
      // mention inside a tool result body
      entries.push(toolResultEntry(id, `${FILLER}\nRead ${path(index)} (42 lines)\n${FILLER}`))
      continue
    }
    if (index % 25 === 23) {
      // an entry without a usable id: it can never be cached and must still be scanned
      entries.push({ type: "message", message: { role: "assistant", content: [{ type: "text", text: `${FILLER} ${path(index)}, noted.` }] } })
      continue
    }
    entries.push(assistantEntry(id, `${FILLER} nothing to see here ${index}. ${FILLER}`))
  }
  return entries
}

describe("createTranscriptMentionIndex", () => {
  test("#given a growing branch #when every 200-entry window is collected #then the exclusion set equals the whole-window regex scan", () => {
    // given
    const documents = corpusDocuments()
    const entries = branchEntries()
    const index = createTranscriptMentionIndex()

    // when / then: the index is reused across the growing branch, so every window after the first
    // is answered incrementally and must still equal the scan over the serialized window.
    for (let size = RECALL_PATH_ENTRY_WINDOW; size <= entries.length; size += 1) {
      const branch = entries.slice(0, size)
      const incremental = index.excludedPaths({ sessionId: SESSION_ID, entries: branch, documents })
      const scanned = excludedPathsByWindowScan(branch.slice(-RECALL_PATH_ENTRY_WINDOW), documents)
      expect([...incremental].sort()).toEqual([...scanned].sort())
    }
  }, 30_000)

  test("#given planted mentions #when the newest window is collected #then delimiters match and false neighbours do not", () => {
    // given
    const documents = corpusDocuments()
    const entries = branchEntries()
    const index = createTranscriptMentionIndex()

    // when
    const excluded = index.excludedPaths({ sessionId: SESSION_ID, entries, documents })

    // then: one representative of each planted shape inside the last 200 entries (indices 50..249)
    expect(excluded.has(path(53))).toBe(true) // mid-entry
    expect(excluded.has(path(57))).toBe(true) // entry end
    expect(excluded.has(path(61))).toBe(true) // escaped quote
    expect(excluded.has(path(63))).toBe(true) // escaped newline
    expect(excluded.has(path(69))).toBe(true) // tool call arguments
    expect(excluded.has(path(71))).toBe(true) // tool result body
    expect(excluded.has(path(73))).toBe(true) // entry without an id
    expect(excluded.has(path(67))).toBe(false) // `.md.bak` false neighbour
    expect(excluded.has("reference/topic-017.md.backup.md")).toBe(false)
    expect(excluded.has(path(3))).toBe(false) // outside the 200-entry window
  }, 30_000)

  test("#given the newest entry is still growing #when it gains a mention #then the exclusion set updates", () => {
    // given
    const documents = corpusDocuments()
    const entries = branchEntries()
    const index = createTranscriptMentionIndex()
    const before = index.excludedPaths({ sessionId: SESSION_ID, entries, documents })
    expect(before.has(path(400))).toBe(false)

    // when: the last entry is mutated in place, exactly as a streaming assistant message grows
    const newest = entries[entries.length - 1] as { message: { content: { text: string }[] } }
    newest.message.content[0]!.text = `${newest.message.content[0]!.text} now reading ${path(400)} too.`
    const after = index.excludedPaths({ sessionId: SESSION_ID, entries, documents })

    // then
    expect(after.has(path(400))).toBe(true)
  }, 30_000)

  test("#given a corpus whose path set changed #when the same window is collected #then the new path set is honoured", () => {
    // given
    const documents = corpusDocuments()
    const entries = branchEntries()
    const index = createTranscriptMentionIndex()
    index.excludedPaths({ sessionId: SESSION_ID, entries, documents })

    // when: a NEW corpus array (a moved HEAD) drops every path but one mentioned in the window
    const narrowed = [{ path: path(53) }]
    const excluded = index.excludedPaths({ sessionId: SESSION_ID, entries, documents: narrowed })

    // then
    expect([...excluded]).toEqual([path(53)])
  }, 30_000)

  test("#given two sessions sharing entry ids #when both collect #then each session keeps its own mentions", () => {
    // given: senpi ids are session-local, so the same id in another session is a different entry
    const documents = corpusDocuments()
    const index = createTranscriptMentionIndex()
    const first = [userEntry("shared-id", `look at ${path(5)} please`), assistantEntry("tail-a", "noted")]
    const second = [userEntry("shared-id", `look at ${path(6)} please`), assistantEntry("tail-b", "noted")]

    // when
    const firstExcluded = index.excludedPaths({ sessionId: "session-a", entries: first, documents })
    const secondExcluded = index.excludedPaths({ sessionId: "session-b", entries: second, documents })

    // then
    expect([...firstExcluded]).toEqual([path(5)])
    expect([...secondExcluded]).toEqual([path(6)])
  })

  test("#given a corpus path containing a JSON array seam #when the window is collected #then the scan fallback keeps the result exact", () => {
    // given: `},` inside a path would let a match straddle two entries in the serialized array
    const documents = [{ path: "reference/weird},name.md" }, { path: path(1) }]
    const entries = [userEntry("m1", `look at reference/weird},name.md now`), userEntry("m2", `and ${path(1)}`)]
    const index = createTranscriptMentionIndex()

    // when
    const excluded = index.excludedPaths({ sessionId: SESSION_ID, entries, documents })

    // then
    expect([...excluded].sort()).toEqual([...excludedPathsByWindowScan(entries, documents)].sort())
    expect(excluded.has("reference/weird},name.md")).toBe(true)
  })

  test("#given a window that drops old entries #when collection repeats #then evicted ids are recomputed, not remembered", () => {
    // given
    const documents = corpusDocuments()
    const entries = branchEntries()
    const index = createTranscriptMentionIndex()
    index.excludedPaths({ sessionId: SESSION_ID, entries, documents })

    // when: the branch is rewound to a window that ends before the newest mentions
    const rewound = entries.slice(0, RECALL_PATH_ENTRY_WINDOW)
    const excluded = index.excludedPaths({ sessionId: SESSION_ID, entries: rewound, documents })

    // then
    expect([...excluded].sort()).toEqual(
      [...excludedPathsByWindowScan(rewound.slice(-RECALL_PATH_ENTRY_WINDOW), documents)].sort(),
    )
  }, 30_000)
})
