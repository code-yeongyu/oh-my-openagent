import type { CleanupCorpus, CleanupNote } from "./corpus"
import type { Declarations } from "./declarations"
import type { CleanupEvidence, KeptNote } from "./types"

export const CONFLICTS_WITH_KEY = "conflicts_with"

export interface ConflictCandidate {
  readonly a: string
  readonly b: string
  readonly evidence: readonly CleanupEvidence[]
  /** The sides whose frontmatter does not yet name the other. */
  readonly marks: readonly string[]
}

export interface ConflictResult {
  readonly candidates: readonly ConflictCandidate[]
  readonly kept: readonly KeptNote[]
}

export function findConflicts(
  corpus: CleanupCorpus,
  declarations: Declarations,
  mutual: readonly (readonly [string, string])[],
  claimed: ReadonlySet<string>,
): ConflictResult {
  const pairs = new Map<string, { readonly a: string; readonly b: string; readonly evidence: CleanupEvidence[] }>()
  const add = (x: string, y: string, evidence: CleanupEvidence): void => {
    const [a, b] = x < y ? [x, y] : [y, x]
    const key = `${a}\0${b}`
    const pair = pairs.get(key)
    if (pair) pair.evidence.push(evidence)
    else pairs.set(key, { a, b, evidence: [evidence] })
  }
  for (const declaration of declarations.conflicts) {
    add(declaration.from, declaration.to, { kind: "declared", detail: declaration.text, at: declaration.at })
  }
  for (const [a, b] of mutual)
    add(a, b, { kind: "mutual-supersession", detail: `${a} and ${b} each declare the other superseded` })

  const candidates: ConflictCandidate[] = []
  const kept: KeptNote[] = []
  for (const pair of [...pairs.values()].sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b))) {
    const archived = [pair.a, pair.b].filter((path) => claimed.has(path))
    if (archived.length > 0) {
      kept.push({
        kind: "party-archived",
        detail: `${archived.join(", ")} already archived by another finding; conflict not marked`,
        paths: [pair.a, pair.b],
      })
      continue
    }
    const noteA = corpus.notes.get(pair.a)
    const noteB = corpus.notes.get(pair.b)
    if (noteA === undefined || noteB === undefined) continue
    const marks = [...(marked(noteA, pair.b) ? [] : [pair.a]), ...(marked(noteB, pair.a) ? [] : [pair.b])]
    if (marks.length === 0) {
      kept.push({
        kind: "conflict-marked",
        detail: `${pair.a} and ${pair.b} already carry ${CONFLICTS_WITH_KEY}; both stay`,
        paths: [pair.a, pair.b],
      })
      continue
    }
    candidates.push({ a: pair.a, b: pair.b, evidence: pair.evidence, marks })
  }
  return { candidates, kept }
}

export function conflictsWithOf(note: Pick<CleanupNote, "frontmatter">): readonly string[] {
  return (note.frontmatter.extra?.[CONFLICTS_WITH_KEY] ?? "").split(/\s+/).filter(Boolean)
}

function marked(note: CleanupNote, other: string): boolean {
  return conflictsWithOf(note).includes(other)
}
