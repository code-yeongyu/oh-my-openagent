/**
 * Memory file frontmatter parse/render.
 *
 * Reader grammar (letta parity, one `key: value` per line, split on the FIRST
 * colon) plus quoted-scalar decoding; renderer output is always strict YAML so
 * the same file reads identically here and in the skill loader (`yaml`).
 *
 * - description: required, non-empty, single line; quoted on output whenever a
 *   plain scalar would not round-trip through strict YAML (`: `, ` #`, `true`,
 *   leading indicators, ...).
 * - read_only: string value preserved verbatim (not coerced to boolean)
 * - kind / aliases: people-record keys (aliases is a JSON array)
 * - limit: tolerated-ignored legacy key
 * - any other key (SKILL.md `name`, `version`, `deprecated`, ...) is preserved
 *   as its raw scalar source in `extra` so edits never drop it
 * - CRLF normalized on read; render emits LF only
 */

import { FRONTMATTER_RE, decodeScalarSource, renderRawScalar, renderStringScalar } from "./frontmatter-scalar"
import { describeHeaderGrammarViolation } from "./frontmatter-validation"

export interface MemoryFrontmatter {
  description: string
  read_only?: string
  kind?: string
  aliases?: readonly string[]
  extra?: Readonly<Record<string, string>>
}

export interface ParsedMemoryFile {
  frontmatter: MemoryFrontmatter
  body: string
}

export class FrontmatterError extends Error {
  override readonly name = "FrontmatterError"
}

const CONTRACT_KEYS: ReadonlySet<string> = new Set(["description", "read_only", "kind", "aliases", "limit"])
const EXTRA_KEY_RE = /^[A-Za-z0-9_-]+$/

export function parseMemoryFile(content: string): ParsedMemoryFile {
  const match = content.match(FRONTMATTER_RE)
  if (!match) {
    throw new FrontmatterError("frontmatter: target file is missing required frontmatter")
  }

  const frontmatterText = match[1] ?? ""
  const body = match[2] ?? ""

  let description: string | undefined
  let readOnly: string | undefined
  let kind: string | undefined
  let aliases: readonly string[] | undefined
  const extra: Record<string, string> = {}

  for (const line of frontmatterText.split(/\r?\n/)) {
    const idx = line.indexOf(":")
    if (idx <= 0) continue

    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()

    if (key === "description") {
      description = decodeScalarSource(value)
    } else if (key === "read_only") {
      readOnly = value
    } else if (key === "kind") {
      kind = decodeScalarSource(value)
    } else if (key === "aliases") {
      aliases = parseAliases(value, line)
    } else if (key !== "limit" && EXTRA_KEY_RE.test(key)) {
      extra[key] = value
    }
  }

  if (!description || !description.trim()) {
    throw new FrontmatterError("frontmatter: target file frontmatter is missing 'description'")
  }

  return {
    frontmatter: {
      description,
      ...(readOnly !== undefined ? { read_only: readOnly } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(aliases !== undefined ? { aliases } : {}),
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    },
    body,
  }
}

/**
 * Render a memory markdown file. Every value is emitted as a scalar that strict
 * YAML reads back verbatim, and the header is re-validated and re-parsed
 * before it is returned, so a file written here can never fail the skill loader.
 */
export function renderMemoryFile(frontmatter: MemoryFrontmatter, body: string): string {
  const description = sanitizeFrontmatterValue(frontmatter.description)
  if (!description) {
    throw new FrontmatterError("frontmatter: 'description' must not be empty")
  }

  const lines = [`description: ${renderStringScalar(description)}`]

  if (frontmatter.read_only !== undefined) {
    lines.push(`read_only: ${frontmatter.read_only}`)
  }

  if (frontmatter.kind !== undefined) {
    lines.push(`kind: ${renderStringScalar(sanitizeFrontmatterValue(frontmatter.kind))}`)
  }

  if (frontmatter.aliases !== undefined) {
    lines.push(`aliases: ${JSON.stringify(frontmatter.aliases)}`)
  }

  for (const [key, raw] of Object.entries(frontmatter.extra ?? {})) {
    if (!EXTRA_KEY_RE.test(key) || CONTRACT_KEYS.has(key)) {
      throw new FrontmatterError(`frontmatter: '${key}' is not a valid extra frontmatter key`)
    }
    lines.push(`${key}: ${renderRawScalar(sanitizeFrontmatterValue(raw))}`)
  }

  const headerText = lines.join("\n")
  const header = `---\n${headerText}\n---`
  const rendered = body ? `${header}\n${body}` : `${header}\n`
  assertStrictRoundTrip(headerText, rendered, { ...frontmatter, description })
  return rendered
}

function assertStrictRoundTrip(headerText: string, rendered: string, frontmatter: MemoryFrontmatter): void {
  const violation = describeHeaderGrammarViolation(headerText)
  if (violation !== null) {
    throw new FrontmatterError(`frontmatter: rendered header is not strict YAML: ${violation}`)
  }
  const reparsed = parseMemoryFile(rendered).frontmatter
  const mismatches: string[] = []
  if (reparsed.description !== frontmatter.description) mismatches.push("description")
  if (reparsed.read_only !== frontmatter.read_only) mismatches.push("read_only")
  if (frontmatter.kind !== undefined && reparsed.kind !== sanitizeFrontmatterValue(frontmatter.kind)) mismatches.push("kind")
  if (JSON.stringify(reparsed.aliases) !== JSON.stringify(frontmatter.aliases)) mismatches.push("aliases")
  for (const key of Object.keys(frontmatter.extra ?? {})) {
    if (reparsed.extra?.[key] === undefined) mismatches.push(key)
  }
  if (mismatches.length > 0) {
    throw new FrontmatterError(`frontmatter: rendered header does not round-trip (${mismatches.join(", ")})`)
  }
}

function sanitizeFrontmatterValue(value: string): string {
  return value.replace(/\r?\n/g, " ").trim()
}

function parseAliases(value: string, rawLine: string): readonly string[] {
  const trimmed = value.trim()
  if (!trimmed.startsWith("[")) {
    throw new FrontmatterError(
      `frontmatter: 'aliases' must be a JSON array of non-empty strings (line: ${rawLine})`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new FrontmatterError(`frontmatter: 'aliases' is not valid JSON (line: ${rawLine})`)
  }

  if (!Array.isArray(parsed)) {
    throw new FrontmatterError(
      `frontmatter: 'aliases' must be a JSON array, not ${typeof parsed} (line: ${rawLine})`,
    )
  }

  for (const item of parsed) {
    if (typeof item !== "string" || item.trim() === "") {
      throw new FrontmatterError(
        `frontmatter: 'aliases' array must contain only non-empty strings (line: ${rawLine})`,
      )
    }
  }

  return parsed as string[]
}
