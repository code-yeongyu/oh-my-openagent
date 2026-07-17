export interface TomlSection {
  readonly start: number
  readonly end: number
  readonly text: string
}

export type TomlMultilineQuote = '"""' | "'''"

export interface TomlMultilineLineScan {
  readonly wasInside: boolean
  readonly nextQuote: TomlMultilineQuote | null
}

export function findTomlSection(config: string, header: string): TomlSection | null {
  const headerLine = `[${header}]`
  const targetHeaderPath = parseTomlDottedKey(header)
  const lines = config.match(/[^\n]*\n?|$/g) ?? []
  let offset = 0
  let start = -1
  let multilineQuote: TomlMultilineQuote | null = null
  for (const line of lines) {
    if (line.length === 0) break
    const multilineScan = scanTomlMultilineLine(line, multilineQuote)
    multilineQuote = multilineScan.nextQuote
    if (multilineScan.wasInside) {
      offset += line.length
      continue
    }
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
  const targetPath = parseTomlDottedKey(key)
  if (!targetPath) return config

  const lines = section.text.match(/[^\n]*\n?|$/g) ?? []
  let offset = 0
  let multilineQuote: TomlMultilineQuote | null = null
  for (const line of lines) {
    if (line.length === 0) break
    const multilineScan = scanTomlMultilineLine(line, multilineQuote)
    multilineQuote = multilineScan.nextQuote
    if (multilineScan.wasInside) {
      offset += line.length
      continue
    }
    const assignmentIndex = findUnquotedAssignment(line)
    if (assignmentIndex < 0) {
      offset += line.length
      continue
    }
    const settingPath = parseTomlDottedKey(line.slice(0, assignmentIndex).trim())
    if (!settingPath || !tomlPathMatches(settingPath, targetPath)) {
      offset += line.length
      continue
    }
    const replacement = replaceTomlAssignmentValue(line, assignmentIndex, value)
    const assignmentEnd = multilineScan.nextQuote
      ? findTomlMultilineValueEnd(section.text, offset + line.length, multilineScan.nextQuote)
      : offset + line.length
    const sectionReplacement = section.text.slice(0, offset) + replacement + section.text.slice(assignmentEnd)
    return config.slice(0, section.start) + sectionReplacement + config.slice(section.end)
  }

  const replacement = insertSetting(section.text, key, value)
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

export function replaceOrInsertRootDottedSetting(config: string, keyPath: string, value: string): string {
  const targetPath = parseTomlDottedKey(keyPath)
  if (!targetPath) return config

  const lines = config.match(/[^\n]*\n?|$/g) ?? []
  let offset = 0
  let multilineQuote: TomlMultilineQuote | null = null
  for (const line of lines) {
    if (line.length === 0) break
    const multilineScan = scanTomlMultilineLine(line, multilineQuote)
    multilineQuote = multilineScan.nextQuote
    if (multilineScan.wasInside) {
      offset += line.length
      continue
    }
    if (isTomlTableHeaderLine(line)) break

    const assignmentIndex = findUnquotedAssignment(line)
    if (assignmentIndex < 0) {
      offset += line.length
      continue
    }
    const settingPath = parseTomlDottedKey(line.slice(0, assignmentIndex).trim())
    if (!settingPath || !tomlPathMatches(settingPath, targetPath)) {
      offset += line.length
      continue
    }
    const replacement = replaceTomlAssignmentValue(line, assignmentIndex, value)
    const assignmentEnd = multilineScan.nextQuote
      ? findTomlMultilineValueEnd(config, offset + line.length, multilineScan.nextQuote)
      : offset + line.length
    return config.slice(0, offset) + replacement + config.slice(assignmentEnd)
  }

  const sectionStart = findFirstTableStart(config)
  const root = config.slice(0, sectionStart).trimEnd()
  const suffix = config.slice(sectionStart)
  const replacement = `${root}${root.length > 0 ? "\n" : ""}${keyPath} = ${value}\n`
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
  let multilineQuote: TomlMultilineQuote | null = null
  for (const line of lines) {
    if (line.length === 0) break
    const multilineScan = scanTomlMultilineLine(line, multilineQuote)
    multilineQuote = multilineScan.nextQuote
    if (multilineScan.wasInside) {
      offset += line.length
      continue
    }
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

export function scanTomlMultilineLine(
  line: string,
  currentQuote: TomlMultilineQuote | null,
): TomlMultilineLineScan {
  if (currentQuote) {
    return {
      wasInside: true,
      nextQuote: findTomlMultilineDelimiter(line, currentQuote, 0) === -1 ? currentQuote : null,
    }
  }

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
    if (char === "#") break
    const delimiter = line.startsWith('"""', index) ? '"""' : line.startsWith("'''", index) ? "'''" : null
    if (delimiter) {
      const closingIndex = findTomlMultilineDelimiter(line, delimiter, index + delimiter.length)
      return { wasInside: false, nextQuote: closingIndex === -1 ? delimiter : null }
    }
    if (char === '"' || char === "'") quote = char
    index += 1
  }
  return { wasInside: false, nextQuote: null }
}

function findTomlMultilineDelimiter(line: string, delimiter: TomlMultilineQuote, startIndex: number): number {
  let index = line.indexOf(delimiter, startIndex)
  while (index !== -1) {
    if (delimiter === "'''" || countPrecedingBackslashes(line, index) % 2 === 0) return index
    index = line.indexOf(delimiter, index + 1)
  }
  return -1
}

function countPrecedingBackslashes(line: string, index: number): number {
  let count = 0
  let cursor = index - 1
  while (cursor >= 0 && line[cursor] === "\\") {
    count += 1
    cursor -= 1
  }
  return count
}

function findUnquotedAssignment(line: string): number {
  return findUnquotedCharacter(line, "=", 0)
}

function findUnquotedComment(line: string, startIndex: number): number {
  return findUnquotedCharacter(line, "#", startIndex)
}

function findUnquotedCharacter(line: string, target: "=" | "#", startIndex: number): number {
  let quote: "'" | '"' | null = null
  let index = startIndex
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
    if (char === target) return index
    if (char === "#") return -1
    index += 1
  }
  return -1
}

function tomlPathMatches(candidate: readonly string[], target: readonly string[]): boolean {
  return candidate.length === target.length && candidate.every((part, index) => part === target[index])
}

function replaceTomlAssignmentValue(line: string, assignmentIndex: number, value: string): string {
  const newline = line.endsWith("\n") ? "\n" : ""
  const lineBody = newline ? line.slice(0, -1) : line
  const commentIndex = findUnquotedComment(lineBody, assignmentIndex + 1)
  const comment = commentIndex === -1 ? "" : ` ${lineBody.slice(commentIndex).trimStart()}`
  return `${lineBody.slice(0, assignmentIndex + 1)} ${value}${comment}${newline}`
}

function findTomlMultilineValueEnd(text: string, startOffset: number, quote: TomlMultilineQuote): number {
  const lines = text.slice(startOffset).match(/[^\n]*\n?|$/g) ?? []
  let offset = startOffset
  let currentQuote: TomlMultilineQuote | null = quote
  for (const line of lines) {
    if (line.length === 0) break
    const scan = scanTomlMultilineLine(line, currentQuote)
    currentQuote = scan.nextQuote
    offset += line.length
    if (currentQuote === null) return offset
  }
  return text.length
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
