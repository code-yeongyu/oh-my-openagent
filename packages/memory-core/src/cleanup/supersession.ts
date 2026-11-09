import type { CleanupCorpus, CleanupNote } from "./corpus"
import type { Declarations } from "./declarations"
import { comparableKeys, percent } from "./duplicates"
import { containment, parseDatedName } from "./text"
import type { CleanupEvidence, KeptNote } from "./types"

export interface SupersededCandidate {
  readonly subject: string
  readonly successor: string
  readonly evidence: readonly CleanupEvidence[]
}

export interface SupersessionResult {
  readonly candidates: readonly SupersededCandidate[]
  /** Pairs that declare each other superseded: a contradiction, never an archive. */
  readonly mutual: readonly (readonly [string, string])[]
  readonly kept: readonly KeptNote[]
}

export function findSuperseded(corpus: CleanupCorpus, declarations: Declarations, threshold: number): SupersessionResult {
  const candidates: SupersededCandidate[] = []
  const subjects = new Set<string>()
  const mutual: (readonly [string, string])[] = []
  const declared = new Set(declarations.supersedes.map((declaration) => `${declaration.from}\0${declaration.to}`))
  for (const declaration of declarations.supersedes) {
    if (declared.has(`${declaration.to}\0${declaration.from}`)) {
      if (declaration.from < declaration.to) mutual.push([declaration.from, declaration.to])
      continue
    }
    if (subjects.has(declaration.to)) continue
    subjects.add(declaration.to)
    candidates.push({
      subject: declaration.to,
      successor: declaration.from,
      evidence: [{ kind: "declared", detail: declaration.text, at: declaration.at }],
    })
  }

  const kept: KeptNote[] = []
  const notes = [...corpus.notes.values()]
  const keysOf = comparableKeys(notes)
  for (const versions of datedSeries(notes).values()) {
    const successors = versions.filter((version) => version.retired === false)
    for (const older of versions) {
      if (subjects.has(older.note.path)) continue
      const olderKeys = keysOf.get(older.note.path) ?? new Set<string>()
      if (olderKeys.size === 0) continue
      const newer = successors.filter((version) => version.version > older.version)
      const covering = [...newer].reverse().find((version) => containment(olderKeys, keysOf.get(version.note.path) ?? new Set()) >= threshold)
      const newest = newer[newer.length - 1]
      if (newest === undefined) continue
      if (covering === undefined) {
        const share = containment(olderKeys, keysOf.get(newest.note.path) ?? new Set())
        kept.push({
          kind: "series-diverges",
          detail: `${newest.note.path} carries ${percent(share)} of ${older.note.path}'s paragraphs (< ${percent(threshold)}); both stay`,
          paths: [older.note.path, newest.note.path],
        })
        continue
      }
      subjects.add(older.note.path)
      const share = containment(olderKeys, keysOf.get(covering.note.path) ?? new Set())
      candidates.push({
        subject: older.note.path,
        successor: covering.note.path,
        evidence: [
          {
            kind: "dated-series",
            detail: `${covering.note.path} carries ${percent(share)} of ${older.note.path}'s ${olderKeys.size} paragraph(s) (threshold ${percent(threshold)})`,
          },
        ],
      })
    }
  }
  return { candidates: candidates.sort((a, b) => a.subject.localeCompare(b.subject)), mutual, kept }
}

interface SeriesVersion {
  readonly note: CleanupNote
  readonly version: string
  readonly retired: boolean
}

function datedSeries(notes: readonly CleanupNote[]): ReadonlyMap<string, readonly SeriesVersion[]> {
  const series = new Map<string, SeriesVersion[]>()
  for (const note of notes) {
    const dated = parseDatedName(note.path)
    if (dated === undefined) continue
    const entry = { note, version: dated.version, retired: dated.retired !== undefined }
    const versions = series.get(dated.series)
    if (versions) versions.push(entry)
    else series.set(dated.series, [entry])
  }
  for (const versions of series.values()) versions.sort((a, b) => a.version.localeCompare(b.version) || a.note.path.localeCompare(b.note.path))
  return new Map([...series].filter(([, versions]) => versions.length > 1))
}
