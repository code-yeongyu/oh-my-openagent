import { parseMemoryFile, renderMemoryFile, type MemoryFrontmatter } from "../memfs/frontmatter"
import { lookAlikeFrontmatterKeys, normalizedFrontmatterKey } from "../memfs/frontmatter-entries"
import { renderClaimReceipt, type ClaimReceipt } from "../provenance"

export const PROVENANCE_FRONTMATTER_KEY = "provenance"
export const MIXED_PROVENANCE = "mixed: parts of this note are not the user's recorded words"
// Commit trailer every writer adds, once per path, when an edit drops a legacy user header (lead decision C on #10498).
export const PROVENANCE_STRIPPED_TRAILER = "Omo-Provenance-Stripped"

const LEGACY_USER_PREFIX = "user said "

export interface StampedNote {
  readonly frontmatter: MemoryFrontmatter
  readonly body: string
}

// The provenance header records where a note's content came from, for a reader who opens the file directly (#10488).
// It never carries the user's authority (decision C): a verified user claim is recorded as "user replied ...; a record,
// not the user's approval", and no writer ever writes a "user said ..." header. A legacy "user said" header from an
// earlier build is dropped on any edit, by every writer and by the commit hook's rule (the hook computes the header it
// accepts with this same function), so the writers and the hook never disagree.
export function stampReceipt(
  previous: StampedNote | undefined,
  next: MemoryFrontmatter,
  body: string,
  claim: ClaimReceipt | undefined,
): MemoryFrontmatter {
  const prior = previous === undefined ? undefined : liveHeader(readHeader(previous.frontmatter))
  const reRender = previous !== undefined && previous.body === body && sameFields(previous.frontmatter, next)
  const header = claim === undefined ? (reRender ? prior : editHeader(prior)) : claimHeader(prior, renderClaimReceipt(claim))
  const rest = Object.fromEntries(Object.entries(next.extra ?? {}).filter(([key]) => normalizedFrontmatterKey(key) !== PROVENANCE_FRONTMATTER_KEY))
  const extra = header === undefined ? rest : { ...rest, [PROVENANCE_FRONTMATTER_KEY]: JSON.stringify(header) }
  const { extra: _extra, ...base } = next
  return Object.keys(extra).length === 0 ? base : { ...base, extra }
}

export function restampContent(previous: string | undefined, next: string, claim: ClaimReceipt | undefined): string {
  const parsed = parseMemoryFile(next)
  const stamped = stampReceipt(previous === undefined ? undefined : parseMemoryFile(previous), parsed.frontmatter, parsed.body, claim)
  // The parser drops keys it does not accept (a Unicode look-alike such as `\u0440rovenance`), so a raw look-alike line
  // can survive an unchanged parse; re-render whenever the raw text carries one, so the memory tool never writes it.
  const rawLookAlike = lookAlikeFrontmatterKeys(next, PROVENANCE_FRONTMATTER_KEY).length > 0
  const unchanged = !rawLookAlike && JSON.stringify(stamped.extra ?? {}) === JSON.stringify(parsed.frontmatter.extra ?? {})
  return unchanged ? next : renderMemoryFile(stamped, parsed.body)
}

export function isLegacyUserHeader(header: string | undefined): boolean {
  return header?.startsWith(LEGACY_USER_PREFIX) === true
}

// True when `before` carried a legacy user header and `after` no longer does: the writer records it with
// PROVENANCE_STRIPPED_TRAILER. Unparseable content counts as no header.
export function strippedLegacyUserHeader(before: string | undefined, after: string): boolean {
  return isLegacyUserHeader(headerOf(before)) && !isLegacyUserHeader(headerOf(after))
}

// One trailer line per path, in first-seen order, for the paths a writer reported dropping a legacy header from.
export function provenanceStrippedTrailers(paths: readonly string[]): string[] {
  return [...new Set(paths)].map((path) => `${PROVENANCE_STRIPPED_TRAILER}: ${path}`)
}

export function hasLegacyUserHeader(content: string | undefined): boolean {
  return isLegacyUserHeader(headerOf(content))
}

function headerOf(content: string | undefined): string | undefined {
  if (content === undefined) return undefined
  try {
    return readHeader(parseMemoryFile(content).frontmatter)
  } catch {
    return undefined
  }
}

function sameFields(a: MemoryFrontmatter, b: MemoryFrontmatter): boolean {
  const fields = (fm: MemoryFrontmatter): string => {
    const extra = Object.entries(fm.extra ?? {}).filter(([key]) => normalizedFrontmatterKey(key) !== PROVENANCE_FRONTMATTER_KEY)
    return JSON.stringify([fm.description, fm.read_only, fm.kind, fm.aliases, extra.map(([key, value]) => [key, value]).sort()])
  }
  return fields(a) === fields(b)
}

function liveHeader(header: string | undefined): string | undefined {
  return isLegacyUserHeader(header) ? undefined : header
}

function isUserRecord(header: string | undefined): boolean {
  return header?.startsWith("user replied ") === true
}

// A content edit without a claim keeps an agent or inferred header and turns a user record into mixed. A pure
// re-render (same body and the same fields apart from provenance, e.g. frontmatter normalization) keeps the header.
function editHeader(prior: string | undefined): string | undefined {
  return isUserRecord(prior) ? MIXED_PROVENANCE : prior
}

// A claim on a note with no live header, or whose header comes from the same kind of source, replaces it; a user
// record over agent content, or the reverse, is mixed.
function claimHeader(prior: string | undefined, rendered: string): string {
  if (prior === undefined || isUserRecord(prior) === isUserRecord(rendered)) return rendered
  return MIXED_PROVENANCE
}

export function readHeader(frontmatter: MemoryFrontmatter): string | undefined {
  const raw = frontmatter.extra?.[PROVENANCE_FRONTMATTER_KEY]
  if (raw === undefined) return undefined
  try {
    const decoded: unknown = JSON.parse(raw)
    return typeof decoded === "string" ? decoded : raw
  } catch {
    return raw
  }
}
