// Explicit relations a note states about another note, by wikilink: "supersedes [[old]]", "superseded by [[new]]",
// "[[new]] supersedes [[old]]", and the conflict verbs. Only a resolvable wikilink counts; prose without one is not
// a declaration.

import { resolveWikilink, scannableLines, type CleanupCorpus } from "./corpus"

export interface Declaration {
  readonly from: string
  readonly to: string
  /** `path:line` where the sentence stands. */
  readonly at: string
  readonly text: string
}

export interface Declarations {
  /** `from` supersedes `to`. */
  readonly supersedes: readonly Declaration[]
  /** `from` conflicts with `to`; the pair is unordered. */
  readonly conflicts: readonly Declaration[]
}

const LINK = String.raw`\[\[([^\]\n]+)\]\]`
const GAP = String.raw`\s*(?:\([^)\n]*\)\s*)?`
const SUPERSEDES = String.raw`(?:supersedes|replaces|obsoletes|reverses)`
const SUPERSEDED_BY = String.raw`(?:superseded|replaced|obsoleted|reversed)\s+by`
const CONFLICTS = String.raw`(?:contradicts|conflicts\s+with|disagrees\s+with)`

const PAIR_SUPERSEDES = new RegExp(`${LINK}${GAP}${SUPERSEDES}\\s+${LINK}`, "gi")
const PAIR_SUPERSEDED_BY = new RegExp(`${LINK}${GAP}${SUPERSEDED_BY}\\s+${LINK}`, "gi")
const PAIR_CONFLICTS = new RegExp(`${LINK}${GAP}${CONFLICTS}\\s+${LINK}`, "gi")
const OWN_SUPERSEDES = new RegExp(String.raw`\b${SUPERSEDES}\s+${LINK}`, "gi")
const OWN_SUPERSEDED_BY = new RegExp(String.raw`\b${SUPERSEDED_BY}\s+${LINK}`, "gi")
const OWN_CONFLICTS = new RegExp(String.raw`\b${CONFLICTS}\s+${LINK}`, "gi")

const MAX_QUOTE = 200

export function readDeclarations(corpus: CleanupCorpus): Declarations {
  const supersedes: Declaration[] = []
  const conflicts: Declaration[] = []
  for (const note of corpus.notes.values()) {
    const written = note.content.split("\n")
    scannableLines(note.content).forEach((line, index) => {
      const at = `${note.path}:${index + 1}`
      const text = quote(written[index] ?? line)
      const resolve = (raw: string | undefined): string | undefined => {
        const target = resolveWikilink(raw ?? "", corpus.files)
        return target !== undefined && corpus.notes.has(target) ? target : undefined
      }
      const declare = (into: Declaration[], from: string | undefined, to: string | undefined): void => {
        if (from !== undefined && to !== undefined && from !== to) into.push({ from, to, at, text })
      }
      let rest = line
      rest = rest.replace(PAIR_SUPERSEDES, (whole, a: string, b: string) => {
        declare(supersedes, resolve(a), resolve(b))
        return " ".repeat(whole.length)
      })
      rest = rest.replace(PAIR_SUPERSEDED_BY, (whole, a: string, b: string) => {
        declare(supersedes, resolve(b), resolve(a))
        return " ".repeat(whole.length)
      })
      rest = rest.replace(PAIR_CONFLICTS, (whole, a: string, b: string) => {
        declare(conflicts, resolve(a), resolve(b))
        return " ".repeat(whole.length)
      })
      for (const found of rest.matchAll(OWN_SUPERSEDES)) declare(supersedes, note.path, resolve(found[1]))
      for (const found of rest.matchAll(OWN_SUPERSEDED_BY)) declare(supersedes, resolve(found[1]), note.path)
      for (const found of rest.matchAll(OWN_CONFLICTS)) declare(conflicts, note.path, resolve(found[1]))
    })
  }
  return { supersedes: dedupe(supersedes), conflicts: dedupe(conflicts) }
}

function dedupe(declarations: readonly Declaration[]): Declaration[] {
  const seen = new Set<string>()
  return declarations.filter((declaration) => {
    const key = `${declaration.from}\0${declaration.to}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function quote(line: string): string {
  const trimmed = line.trim()
  return trimmed.length <= MAX_QUOTE ? trimmed : `${trimmed.slice(0, MAX_QUOTE - 1)}…`
}
