import { FRONTMATTER_RE } from "./frontmatter-scalar"
import { lookAlikeSkeleton } from "./lookalike-text"

export interface FrontmatterEntry {
  readonly key: string
  readonly value: string
  readonly line: string
}

// The one reading of a frontmatter block's key lines. parseMemoryFile builds a note from these entries
// and the memory commit hooks check the same entries, so what a hook refuses and what the reader
// trusts cannot drift apart (#10498: the shell hooks had their own reading and were bypassed).
export function frontmatterEntries(frontmatterText: string): FrontmatterEntry[] {
  const entries: FrontmatterEntry[] = []
  for (const line of frontmatterText.split(/\r?\n/)) {
    const idx = line.indexOf(":")
    if (idx <= 0) continue
    entries.push({ key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim(), line })
  }
  return entries
}

export function contentFrontmatterEntries(content: string): FrontmatterEntry[] | undefined {
  const match = content.match(FRONTMATTER_RE)
  return match === null ? undefined : frontmatterEntries(match[1] ?? "")
}

export function duplicateFrontmatterKeys(content: string): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const { key } of contentFrontmatterEntries(content) ?? []) (seen.has(key) ? duplicates : seen).add(key)
  return [...duplicates]
}

// How a reader might take a key: its look-alike skeleton (lookalike-text.ts), with surrounding quotes removed. A key
// that reads as `canonical` but is not spelled exactly so (`Provenance`, `"provenance"`, `\u0440rovenance`,
// `provenance\u200b`) is a look-alike.
export function normalizedFrontmatterKey(key: string): string {
  return lookAlikeSkeleton(key).replace(/^["']+|["']+$/g, "").trim()
}

export function lookAlikeFrontmatterKeys(content: string, canonical: string): string[] {
  return (contentFrontmatterEntries(content) ?? []).map((entry) => entry.key).filter((key) => key !== canonical && normalizedFrontmatterKey(key) === canonical)
}
