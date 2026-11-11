import type { CleanupCorpus, CleanupNote } from "./corpus"
import { jaccard } from "./text"
import type { CleanupEvidence } from "./types"

export interface DuplicateCandidate {
  /** The copy that would be archived. */
  readonly subject: string
  readonly canonical: string
  readonly evidence: readonly CleanupEvidence[]
  /** Paragraphs of `subject` the canonical does not carry, verbatim and in order. */
  readonly distinctive: readonly string[]
}

/** A paragraph shared by more notes than this is boilerplate (a section heading, a template line), not a fact. */
const BOILERPLATE_NOTES = 10

export function findDuplicates(
  corpus: CleanupCorpus,
  similarity: number,
  claimed: ReadonlySet<string>,
): DuplicateCandidate[] {
  const notes = [...corpus.notes.values()].filter((note) => !claimed.has(note.path)).sort(byPath)
  const archived = new Set<string>()
  const candidates: DuplicateCandidate[] = []
  const emit = (a: CleanupNote, b: CleanupNote, evidence: CleanupEvidence): void => {
    if (archived.has(a.path) || archived.has(b.path)) return
    const [canonical, other] = rank(a, b, corpus) <= 0 ? [a, b] : [b, a]
    archived.add(other.path)
    const canonicalKeys = new Set(canonical.paragraphs.map((paragraph) => paragraph.key))
    candidates.push({
      subject: other.path,
      canonical: canonical.path,
      evidence: [evidence, canonicalEvidence(canonical, corpus)],
      distinctive: other.paragraphs
        .filter((paragraph) => !canonicalKeys.has(paragraph.key))
        .map((paragraph) => paragraph.text),
    })
  }

  const byBody = new Map<string, CleanupNote[]>()
  for (const note of notes) {
    if (note.body.trim() === "") continue
    const group = byBody.get(note.bodyKey)
    if (group) group.push(note)
    else byBody.set(note.bodyKey, [note])
  }
  for (const group of byBody.values()) {
    const [first, ...rest] = group
    if (first === undefined) continue
    for (const other of rest)
      emit(first, other, {
        kind: "identical-body",
        detail: "same body once markup, case and whitespace are normalised",
      })
  }

  const keysOf = comparableKeys(notes)
  const pairs = new Map<string, { readonly a: CleanupNote; readonly b: CleanupNote; shared: number }>()
  const index = new Map<string, CleanupNote[]>()
  for (const note of notes) {
    for (const key of keysOf.get(note.path) ?? []) {
      const holders = index.get(key)
      if (holders) holders.push(note)
      else index.set(key, [note])
    }
  }
  for (const holders of index.values()) {
    for (let i = 0; i < holders.length; i += 1) {
      for (let j = i + 1; j < holders.length; j += 1) {
        const a = holders[i]
        const b = holders[j]
        if (a === undefined || b === undefined) continue
        const id = `${a.path}\0${b.path}`
        const pair = pairs.get(id)
        if (pair) pair.shared += 1
        else pairs.set(id, { a, b, shared: 1 })
      }
    }
  }
  const scored = [...pairs.values()]
    .filter((pair) => pair.a.bodyKey !== pair.b.bodyKey)
    .map((pair) => {
      const a = keysOf.get(pair.a.path) ?? new Set<string>()
      const b = keysOf.get(pair.b.path) ?? new Set<string>()
      return { ...pair, score: jaccard(a, b), union: a.size + b.size - pair.shared }
    })
    .filter((pair) => pair.score >= similarity)
    .sort((left, right) => right.score - left.score || byPath(left.a, right.a) || byPath(left.b, right.b))
  for (const pair of scored) {
    emit(pair.a, pair.b, {
      kind: "similar-body",
      detail: `shares ${pair.shared} of ${pair.union} distinct paragraphs (${percent(pair.score)}; threshold ${percent(similarity)})`,
    })
  }
  return candidates.sort((left, right) => left.subject.localeCompare(right.subject))
}

/** Paragraph keys per note with boilerplate removed, so a shared template line never makes two notes similar. */
export function comparableKeys(notes: readonly CleanupNote[]): ReadonlyMap<string, ReadonlySet<string>> {
  const frequency = new Map<string, number>()
  for (const note of notes) {
    for (const key of new Set(note.paragraphs.map((paragraph) => paragraph.key))) {
      frequency.set(key, (frequency.get(key) ?? 0) + 1)
    }
  }
  const keys = new Map<string, ReadonlySet<string>>()
  for (const note of notes) {
    keys.set(
      note.path,
      new Set(
        note.paragraphs
          .map((paragraph) => paragraph.key)
          .filter((key) => (frequency.get(key) ?? 0) <= BOILERPLATE_NOTES),
      ),
    )
  }
  return keys
}

/** Negative when `a` is the better canonical: more inbound links, then more paragraphs, then more bytes, then path order. */
function rank(a: CleanupNote, b: CleanupNote, corpus: CleanupCorpus): number {
  return (
    inbound(b.path, corpus) - inbound(a.path, corpus) ||
    b.paragraphs.length - a.paragraphs.length ||
    b.bytes - a.bytes ||
    a.path.localeCompare(b.path)
  )
}

function canonicalEvidence(canonical: CleanupNote, corpus: CleanupCorpus): CleanupEvidence {
  return {
    kind: "canonical",
    detail: `${canonical.path} kept: ${inbound(canonical.path, corpus)} inbound link(s), ${canonical.paragraphs.length} paragraph(s), ${canonical.bytes} bytes`,
  }
}

function inbound(path: string, corpus: CleanupCorpus): number {
  return corpus.inbound.get(path)?.size ?? 0
}

function byPath(a: CleanupNote, b: CleanupNote): number {
  return a.path.localeCompare(b.path)
}

export function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}
