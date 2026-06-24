export interface TomlSection {
  readonly start: number
  readonly end: number
  readonly text: string
}

export function findTomlSection(config: string, header: string): TomlSection | null {
  const headerLine = `[${header}]`
  const targetHeaderPath = parseTomlDottedKey(header)
  const lines = config.match(/[^\n]*\n?|$/g) ?? []
  let offset = 0
  let start = -1
  for (const line of lines) {
    if (line.length === 0) break
    const trimmed = line.trim()
    if (start === -1) {
      if (tomlTableHeaderMatches(trimmed, headerLine, targetHeaderPath)) start = offset
    } else if (isTomlTableHeaderLine(line)) {
      return { start, end: offset, text: config.slice(start, offset) }
    }
    offset += line.length
  }
  if (start === -1) return null
  return { start, end: config.length, text: config.slice(start) }
}

export function replaceOrInsertSetting(config: string, section: TomlSection, key: string, value: string): string {
  const linePattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=.*$`, "m")
  const replacement = linePattern.test(section.text)
    ? section.text.replace(linePattern, `${key} = ${value}`)
    : insertSetting(section.text, key, value)
  return config.slice(0, section.start) + replacement + config.slice(section.end)
}

export function removeSetting(config: string, section: TomlSection, key: string): string {
  const linePattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=.*(?:\\n|$)`, "m")
  const replacement = section.text.replace(linePattern, "")
  return config.slice(0, section.start) + replacement + config.slice(section.end)
}

export function replaceOrInsertRootSetting(config: string, key: string, value: string): string {
  const sectionStart = findFirstTableStart(config)
  const root = config.slice(0, sectionStart)
  const suffix = config.slice(sectionStart)
  const linePattern = new RegExp(`^[ \\t]*${escapeRegExp(key)}[ \\t]*=.*$`, "m")
  const replacement = linePattern.test(root)
    ? root.replace(linePattern, `${key} = ${value}`)
    : `${root.trimEnd()}${root.trimEnd().length > 0 ? "\n" : ""}${key} = ${value}\n`
  if (suffix.length === 0) return replacement
  return `${replacement.trimEnd()}\n\n${suffix.trimStart()}`
}

export function appendBlock(config: string, block: string): string {
  const prefix = config.trimEnd()
  return `${prefix}${prefix.length > 0 ? "\n\n" : ""}${block.trimEnd()}\n`
}

function findFirstTableStart(config: string): number {
  const lines = config.match(/[^\n]*\n?|$/g) ?? []
  let offset = 0
  for (const line of lines) {
    if (line.length === 0) break
    if (isTomlTableHeaderLine(line)) return offset
    offset += line.length
  }
  return config.length
}

function insertSetting(sectionText: string, key: string, value: string): string {
  const lines = sectionText.split("\n")
  lines.splice(1, 0, `${key} = ${value}`)
  return lines.join("\n")
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function tomlTableHeaderMatches(line: string, headerLine: string, targetHeaderPath: readonly string[] | null): boolean {
  const normalizedLine = stripUnquotedInlineComment(line).trim()
  if (normalizedLine === headerLine) return true
  if (!targetHeaderPath) return false
  const candidateHeaderPath = parseTomlTableHeader(normalizedLine)
  if (!candidateHeaderPath || candidateHeaderPath.length !== targetHeaderPath.length) return false
  return candidateHeaderPath.every((part, index) => part === targetHeaderPath[index])
}

function parseTomlTableHeader(line: string): readonly string[] | null {
  const normalizedLine = stripUnquotedInlineComment(line).trim()
  if (!normalizedLine.startsWith("[") || !normalizedLine.endsWith("]") || normalizedLine.startsWith("[[")) return null
  return parseTomlDottedKey(normalizedLine.slice(1, -1).trim())
}

export function isTomlTableHeaderLine(line: string): boolean {
  const normalizedLine = stripUnquotedInlineComment(line).trim()
  return normalizedLine.startsWith("[") && normalizedLine.endsWith("]")
}

function stripUnquotedInlineComment(line: string): string {
  let quote: "'" | '"' | null = null
  let index = 0
  while (index < line.length) {
    const char = line[index]
    if (quote === '"') {
      if (char === "\\") {
        index += 2
        continue
      }
      if (char === '"') quote = null
      index += 1
      continue
    }
    if (quote === "'") {
      if (char === "'") quote = null
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      index += 1
      continue
    }
    if (char === "#") return line.slice(0, index)
    index += 1
  }
  return line
}

export function parseTomlDottedKey(input: string): readonly string[] | null {
  const parts: string[] = []
  let index = 0
  while (index < input.length) {
    index = skipWhitespace(input, index)
    const parsedKey = parseTomlKeyPart(input, index)
    if (!parsedKey) return null
    parts.push(parsedKey.value)
    index = skipWhitespace(input, parsedKey.nextIndex)
    if (index === input.length) return parts
    if (input[index] !== ".") return null
    index += 1
  }
  return parts.length > 0 ? parts : null
}

function parseTomlKeyPart(input: string, startIndex: number): { readonly value: string; readonly nextIndex: number } | null {
  const quote = input[startIndex]
  if (quote === "'") return parseLiteralTomlString(input, startIndex)
  if (quote === '"') return parseBasicTomlString(input, startIndex)
  return parseBareTomlKey(input, startIndex)
}

function parseLiteralTomlString(
  input: string,
  startIndex: number,
): { readonly value: string; readonly nextIndex: number } | null {
  let index = startIndex + 1
  let value = ""
  while (index < input.length) {
    const char = input[index]
    if (char === "'") return { value, nextIndex: index + 1 }
    value += char
    index += 1
  }
  return null
}

function parseBasicTomlString(
  input: string,
  startIndex: number,
): { readonly value: string; readonly nextIndex: number } | null {
  let index = startIndex + 1
  let value = ""
  while (index < input.length) {
    const char = input[index]
    if (char === '"') return { value, nextIndex: index + 1 }
    if (char !== "\\") {
      value += char
      index += 1
      continue
    }
    const escaped = parseBasicTomlEscape(input, index)
    if (!escaped) return null
    value += escaped.value
    index = escaped.nextIndex
  }
  return null
}

function parseBasicTomlEscape(
  input: string,
  backslashIndex: number,
): { readonly value: string; readonly nextIndex: number } | null {
  const escape = input[backslashIndex + 1]
  if (escape === undefined) return null
  if (escape === "b") return { value: "\b", nextIndex: backslashIndex + 2 }
  if (escape === "t") return { value: "\t", nextIndex: backslashIndex + 2 }
  if (escape === "n") return { value: "\n", nextIndex: backslashIndex + 2 }
  if (escape === "f") return { value: "\f", nextIndex: backslashIndex + 2 }
  if (escape === "r") return { value: "\r", nextIndex: backslashIndex + 2 }
  if (escape === '"') return { value: '"', nextIndex: backslashIndex + 2 }
  if (escape === "\\") return { value: "\\", nextIndex: backslashIndex + 2 }
  if (escape === "u") return parseUnicodeEscape(input, backslashIndex + 2, 4)
  if (escape === "U") return parseUnicodeEscape(input, backslashIndex + 2, 8)
  return null
}

function parseUnicodeEscape(
  input: string,
  digitsStart: number,
  digitCount: number,
): { readonly value: string; readonly nextIndex: number } | null {
  const digits = input.slice(digitsStart, digitsStart + digitCount)
  if (digits.length !== digitCount || !/^[0-9A-Fa-f]+$/.test(digits)) return null
  const codePoint = Number.parseInt(digits, 16)
  if (codePoint > 0x10ffff) return null
  return { value: String.fromCodePoint(codePoint), nextIndex: digitsStart + digitCount }
}

function parseBareTomlKey(input: string, startIndex: number): { readonly value: string; readonly nextIndex: number } | null {
  let index = startIndex
  while (index < input.length && /[A-Za-z0-9_-]/.test(input[index])) index += 1
  if (index === startIndex) return null
  return { value: input.slice(startIndex, index), nextIndex: index }
}

function skipWhitespace(input: string, startIndex: number): number {
  let index = startIndex
  while (index < input.length && /\s/.test(input[index])) index += 1
  return index
}
