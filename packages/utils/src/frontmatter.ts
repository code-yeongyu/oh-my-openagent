import yaml from "js-yaml"

export type FrontmatterMode = "default" | "rule"

export interface ParseFrontmatterOptions {
  readonly mode?: FrontmatterMode
}

export interface FrontmatterResult<T = Record<string, unknown>> {
  data: T
  body: string
  hadFrontmatter: boolean
  parseError: boolean
}

export interface RuleFrontmatterData {
  readonly description?: string
  readonly alwaysApply?: boolean
  readonly globs?: string | readonly string[]
}

type GlobValue = string | readonly string[]

type ParsedGlobValue = {
  readonly value: GlobValue
  readonly consumed: number
}

export function parseFrontmatter<T = Record<string, unknown>>(
  content: string,
  options: ParseFrontmatterOptions = {}
): FrontmatterResult<T> {
  if (options.mode === "rule") return parseRuleFrontmatter<T>(content)

  const normalized = stripBom(content)
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n([\s\S]*)$/
  const match = normalized.match(frontmatterRegex)

  if (!match) {
    return { data: {} as T, body: normalized, hadFrontmatter: false, parseError: false }
  }

  const yamlContent = match[1]
  const body = match[2]

  try {
    // Use JSON_SCHEMA for security - prevents code execution via YAML tags
    const parsed = yaml.load(yamlContent, { schema: yaml.JSON_SCHEMA })
    const data = (parsed ?? {}) as T
    return { data, body, hadFrontmatter: true, parseError: false }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { data: {} as T, body, hadFrontmatter: true, parseError: true }
  }
}

function parseRuleFrontmatter<T>(content: string): FrontmatterResult<T> {
  const normalized = stripBom(content)
  const openingLength = openingDelimiterLength(normalized)
  if (openingLength === 0) {
    return { data: {} as T, body: normalized, hadFrontmatter: false, parseError: false }
  }
  const closing = findClosingDelimiter(normalized, openingLength)
  if (!closing) {
    return { data: {} as T, body: normalized, hadFrontmatter: false, parseError: false }
  }

  try {
    const data = parseRuleYaml(normalized.slice(openingLength, closing.start)) as T
    return { data, body: normalized.slice(closing.bodyStart), hadFrontmatter: true, parseError: false }
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { data: {} as T, body: normalized, hadFrontmatter: true, parseError: true }
  }
}

function parseRuleYaml(yamlContent: string): RuleFrontmatterData {
  const lines = yamlContent.replace(/\r\n/g, "\n").split("\n")
  const metadata: { description?: string; alwaysApply?: boolean; globs?: string | string[] } = {}
  let index = 0
  while (index < lines.length) {
    const line = stripComment(lines[index] ?? "").trim()
    if (!line) {
      index += 1
      continue
    }
    const colon = line.indexOf(":")
    if (colon === -1) {
      index += 1
      continue
    }
    const key = line.slice(0, colon).trim()
    const rawValue = line.slice(colon + 1).trim()
    if (key === "description") metadata.description = parseString(rawValue)
    else if (key === "alwaysApply") metadata.alwaysApply = rawValue === "true"
    else if (key === "globs" || key === "paths" || key === "applyTo") {
      const parsed = parseGlobValue(rawValue, lines, index)
      metadata.globs = mergeGlobs(metadata.globs, parsed.value)
      index += parsed.consumed
      continue
    }
    index += 1
  }
  return metadata
}

function parseGlobValue(rawValue: string, lines: readonly string[], currentIndex: number): ParsedGlobValue {
  if (rawValue.startsWith("[")) return { value: parseInlineArray(rawValue), consumed: 1 }
  if (!rawValue) {
    const parsed = parseMultilineArray(lines, currentIndex)
    return parsed.values.length > 0 ? { value: parsed.values, consumed: parsed.consumed } : { value: "", consumed: 1 }
  }
  const value = parseString(rawValue)
  if (value.includes(",")) return { value: value.split(",").map((item) => item.trim()).filter(Boolean), consumed: 1 }
  return { value, consumed: 1 }
}

function parseMultilineArray(lines: readonly string[], currentIndex: number): { readonly values: readonly string[]; readonly consumed: number } {
  const values: string[] = []
  let consumed = 1
  for (let index = currentIndex + 1; index < lines.length; index += 1) {
    const line = stripComment(lines[index] ?? "")
    if (line.trim().length === 0) {
      consumed += 1
      continue
    }
    const item = line.match(/^\s+-\s*(.*)$/)
    if (!item) break
    const value = parseString(item[1] ?? "")
    if (value) values.push(value)
    consumed += 1
  }
  return { values, consumed }
}

function parseInlineArray(value: string): string[] {
  const closing = value.lastIndexOf("]")
  if (closing === -1) return []
  return splitCommaSeparated(value.slice(1, closing)).map(parseString).filter(Boolean)
}

function mergeGlobs(existing: string | string[] | undefined, next: GlobValue): string | string[] {
  if (Array.isArray(next) && next.length === 0) return existing ?? []
  if (!Array.isArray(next) && next.length === 0) return existing ?? ""
  if (existing === undefined) return typeof next === "string" ? next : [...next]
  const existingValues = Array.isArray(existing) ? existing : [existing]
  const nextValues = typeof next === "string" ? [next] : [...next]
  return [...existingValues, ...nextValues]
}

function splitCommaSeparated(value: string): string[] {
  const values: string[] = []
  let current = ""
  let quote: string | null = null
  let escaped = false
  for (const character of value) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (quote && character === "\\") {
      escaped = true
      continue
    }
    if (character === '"' || character === "'") {
      if (!quote) quote = character
      else if (quote === character) quote = null
      current += character
      continue
    }
    if (!quote && character === ",") {
      values.push(current.trim())
      current = ""
      continue
    }
    current += character
  }
  values.push(current.trim())
  return values
}

function parseString(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function stripComment(line: string): string {
  let quote: string | null = null
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"' || character === "'") {
      if (!quote) quote = character
      else if (quote === character) quote = null
    }
    if (!quote && character === "#") return line.slice(0, index)
  }
  return line
}

function stripBom(content: string): string {
  return content.startsWith("\uFEFF") ? content.slice(1) : content
}

function openingDelimiterLength(content: string): number {
  if (content.startsWith("---\r\n")) return 5
  if (content.startsWith("---\n")) return 4
  return 0
}

function findClosingDelimiter(content: string, openingLength: number): { readonly start: number; readonly bodyStart: number } | null {
  let lineStart = openingLength
  while (lineStart <= content.length) {
    const nextNewline = content.indexOf("\n", lineStart)
    const lineEnd = nextNewline === -1 ? content.length : nextNewline
    if (content.slice(lineStart, lineEnd).replace(/\r$/, "") === "---") {
      return { start: lineStart, bodyStart: nextNewline === -1 ? content.length : nextNewline + 1 }
    }
    if (nextNewline === -1) break
    lineStart = nextNewline + 1
  }
  return null
}
