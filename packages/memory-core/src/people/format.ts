/**
 * People card + observation format (IC-14, IC-16).
 *
 * Config-free: the omo-senpi side passes `memory.people.*` limits in.
 * Violations return diagnostics in the parse result; they never throw.
 *
 * Card lines use four prefixes: IDENTITY, ATTRIBUTE, RELATIONSHIP, INSTRUCTION.
 * Observations are grouped under `## Explicit`, `## Deductive`,
 * `## Inductive`, `## Contradiction` sections, each entry carrying an
 * optional `<!-- src: ...; n=...; pattern: ...; confidence: ...; status: ... -->`
 * comment.
 *
 * Slug rules reuse the existing `sanitizeToSlug` (IC-14): `human` is reserved
 * for the primary human, collisions append `-2`, `-3`, ...
 */

import { sanitizeToSlug } from "../identity/resolve"

export type CardPrefix = "IDENTITY" | "ATTRIBUTE" | "RELATIONSHIP" | "INSTRUCTION"

const VALID_PREFIXES = new Set<CardPrefix>([
  "IDENTITY",
  "ATTRIBUTE",
  "RELATIONSHIP",
  "INSTRUCTION",
])

export type ObservationSection =
  | "Explicit"
  | "Deductive"
  | "Inductive"
  | "Contradiction"

const VALID_SECTIONS = new Set<ObservationSection>([
  "Explicit",
  "Deductive",
  "Inductive",
  "Contradiction",
])

export interface CardEntry {
  readonly prefix: CardPrefix
  readonly content: string
}

export interface ObservationEntry {
  readonly date: string
  readonly content: string
  readonly src?: string
  readonly n?: number
  readonly pattern?: string
  readonly confidence?: string
  readonly status?: string
}

export interface ObservationGroup {
  readonly section: ObservationSection
  readonly entries: readonly ObservationEntry[]
}

export interface PeopleCard {
  readonly entries: readonly CardEntry[]
  readonly observations?: readonly ObservationGroup[]
}

export interface PeopleLimits {
  readonly maxEntries: number
  readonly maxEntryChars: number
}

export interface PeopleCardParseResult {
  readonly card: PeopleCard
  readonly diagnostics: readonly string[]
}

const OBSERVATION_SECTION_RE = /^##\s+(.+)$/
const OBSERVATION_ENTRY_RE =
  /^-\s+\[(\d{4}-\d{2}-\d{2})\]\s+(.*)$/
const COMMENT_RE = /<!--\s*(.+?)\s*-->$/

/**
 * Parse a people card body into structured entries and observation groups.
 * Returns diagnostics for invalid lines; never throws.
 */
export function parsePeopleCard(
  text: string,
  limits: PeopleLimits,
): PeopleCardParseResult {
  const diagnostics: string[] = []
  const entries: CardEntry[] = []
  const observations: ObservationGroup[] = []

  const lines = text.split("\n")
  let currentSection: ObservationSection | null = null
  let currentEntries: ObservationEntry[] = []

  const flushSection = (): void => {
    if (currentSection !== null && currentEntries.length > 0) {
      observations.push({
        section: currentSection,
        entries: [...currentEntries],
      })
    }
    currentSection = null
    currentEntries = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    // Skip blank lines
    if (line.trim() === "") continue

    // Skip comment-only lines (markdown comments starting with #)
    if (line.trimStart().startsWith("#") && !OBSERVATION_SECTION_RE.test(line.trim())) {
      continue
    }

    // Observation section header
    const sectionMatch = line.match(OBSERVATION_SECTION_RE)
    if (sectionMatch) {
      flushSection()
      const sectionName = sectionMatch[1]!.trim()
      if (!VALID_SECTIONS.has(sectionName as ObservationSection)) {
        diagnostics.push(
          `line ${i + 1}: unknown observation section '${sectionName}' (expected: ${[...VALID_SECTIONS].join(", ")})`,
        )
        currentSection = sectionName as ObservationSection
        currentEntries = []
        continue
      }
      currentSection = sectionName as ObservationSection
      currentEntries = []
      continue
    }

    // Observation entry
    const entryMatch = line.match(OBSERVATION_ENTRY_RE)
    if (entryMatch) {
      if (currentSection === null) {
        diagnostics.push(
          `line ${i + 1}: observation entry outside any section`,
        )
        continue
      }
      const date = entryMatch[1]!
      const rest = entryMatch[2]!

      // Extract optional comment
      let content = rest
      let commentFields: Record<string, string | number | undefined> = {}
      const commentMatch = rest.match(COMMENT_RE)
      if (commentMatch) {
        content = rest.slice(0, commentMatch.index!).trim()
        commentFields = parseCommentFields(commentMatch[1]!)
      }

      currentEntries.push({
        date,
        content,
        ...(commentFields.src !== undefined ? { src: String(commentFields.src) } : {}),
        ...(commentFields.n !== undefined ? { n: Number(commentFields.n) } : {}),
        ...(commentFields.pattern !== undefined ? { pattern: String(commentFields.pattern) } : {}),
        ...(commentFields.confidence !== undefined ? { confidence: String(commentFields.confidence) } : {}),
        ...(commentFields.status !== undefined ? { status: String(commentFields.status) } : {}),
      })
      continue
    }

    // Card entry line
    const colonIdx = line.indexOf(":")
    if (colonIdx > 0) {
      const prefix = line.slice(0, colonIdx).trim()
      const content = line.slice(colonIdx + 1).trim()

      if (VALID_PREFIXES.has(prefix as CardPrefix)) {
        if (content === "") {
          diagnostics.push(
            `line ${i + 1}: ${prefix} entry has empty content`,
          )
          continue
        }
        if (content.length > limits.maxEntryChars) {
          diagnostics.push(
            `line ${i + 1}: entry exceeds ${limits.maxEntryChars} chars (got ${content.length})`,
          )
        }
        entries.push({ prefix: prefix as CardPrefix, content })
        continue
      }

      diagnostics.push(
        `line ${i + 1}: invalid prefix '${prefix}' (expected: ${[...VALID_PREFIXES].join(", ")})`,
      )
      continue
    }

    // Unrecognized non-empty line outside a section
    if (currentSection === null) {
      diagnostics.push(
        `line ${i + 1}: unrecognized line format`,
      )
    }
  }

  flushSection()

  if (entries.length > limits.maxEntries) {
    diagnostics.push(
      `card has ${entries.length} entries, exceeding max ${limits.maxEntries}`,
    )
  }

  const card: PeopleCard = {
    entries,
    ...(observations.length > 0 ? { observations } : {}),
  }

  return { card, diagnostics }
}

/**
 * Serialize a PeopleCard back into text form.
 */
export function serializePeopleCard(
  card: PeopleCard,
  _limits: PeopleLimits,
): string {
  const parts: string[] = []

  for (const entry of card.entries) {
    parts.push(`${entry.prefix}: ${entry.content}`)
  }

  if (card.observations && card.observations.length > 0) {
    for (const group of card.observations) {
      if (parts.length > 0) parts.push("")
      parts.push(`## ${group.section}`)
      parts.push("")
      for (const entry of group.entries) {
        let line = `- [${entry.date}] ${entry.content}`
        const commentParts: string[] = []
        if (entry.src !== undefined) commentParts.push(`src: ${entry.src}`)
        if (entry.n !== undefined) commentParts.push(`n=${entry.n}`)
        if (entry.pattern !== undefined) commentParts.push(`pattern: ${entry.pattern}`)
        if (entry.confidence !== undefined) commentParts.push(`confidence: ${entry.confidence}`)
        if (entry.status !== undefined) commentParts.push(`status: ${entry.status}`)
        if (commentParts.length > 0) {
          line += ` <!-- ${commentParts.join("; ")} -->`
        }
        parts.push(line)
      }
    }
  }

  return parts.join("\n")
}

/**
 * Parse the observation comment fields: `src: ids; n=2; pattern: type; confidence: level; status: state`
 */
function parseCommentFields(raw: string): Record<string, string | number | undefined> {
  const fields: Record<string, string | number | undefined> = {}
  const segments = raw.split(";")

  for (const segment of segments) {
    const trimmed = segment.trim()
    if (trimmed === "") continue

    // n= is a key=value with =
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim()
      const value = trimmed.slice(eqIdx + 1).trim()
      if (key === "n") {
        const num = Number(value)
        if (!Number.isNaN(num)) {
          fields.n = num
        }
        continue
      }
    }

    // key: value
    const colonIdx = trimmed.indexOf(":")
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim()
      const value = trimmed.slice(colonIdx + 1).trim()
      if (key === "src") fields.src = value
      else if (key === "pattern") fields.pattern = value
      else if (key === "confidence") fields.confidence = value
      else if (key === "status") fields.status = value
    }
  }

  return fields
}

/**
 * Sanitize a display name into a person slug (IC-14).
 * Reuses the existing sanitizeToSlug.
 */
export function sanitizePersonSlug(displayName: string): string {
  return sanitizeToSlug(displayName)
}

/**
 * Returns true if the slug is reserved for the primary human.
 */
export function isReservedSlug(slug: string): boolean {
  return slug === "human"
}

/**
 * Resolve a slug collision by appending -2, -3, ... (IC-14).
 * Returns the first unused slug.
 */
export function resolveSlugCollision(
  baseSlug: string,
  existingSlugs: ReadonlySet<string>,
): string {
  if (!existingSlugs.has(baseSlug)) return baseSlug

  let suffix = 2
  while (existingSlugs.has(`${baseSlug}-${suffix}`)) {
    suffix++
  }
  return `${baseSlug}-${suffix}`
}
