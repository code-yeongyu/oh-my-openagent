import { parseTomlDottedKey, scanTomlMultilineLine, type TomlMultilineQuote } from "./toml-section-editor"

export function hasTomlSetting(config: string, keyPath: string): boolean {
  const targetPath = parseTomlDottedKey(keyPath)
  if (!targetPath) return false

  return hasTomlAssignment(config, (tablePath, settingPath) => {
    const fullPath = [...tablePath, ...settingPath]
    return fullPath.length === targetPath.length && fullPath.every((part, index) => part === targetPath[index])
  })
}

export function hasTomlRootDottedKeyPrefix(config: string, rootKey: string): boolean {
  return hasTomlAssignment(
    config,
    (tablePath, settingPath) => tablePath.length === 0 && settingPath.length > 1 && settingPath[0] === rootKey,
  )
}

function hasTomlAssignment(
  config: string,
  predicate: (tablePath: readonly string[], settingPath: readonly string[]) => boolean,
): boolean {
  let tablePath: readonly string[] | null = []
  let multilineQuote: TomlMultilineQuote | null = null
  for (const line of config.split("\n")) {
    const multilineScan = scanTomlMultilineLine(line, multilineQuote)
    multilineQuote = multilineScan.nextQuote
    if (multilineScan.wasInside) continue
    const normalizedLine = stripUnquotedInlineComment(line).trim()
    if (normalizedLine.length === 0) continue

    const headerPath = parseTomlTableHeader(normalizedLine)
    if (headerPath) {
      tablePath = headerPath
      continue
    }
    if (isTomlTableHeaderLine(normalizedLine)) {
      tablePath = null
      continue
    }
    if (!tablePath) continue

    const assignmentIndex = findUnquotedAssignment(normalizedLine)
    if (assignmentIndex < 0) continue
    const settingPath = parseTomlDottedKey(normalizedLine.slice(0, assignmentIndex).trim())
    if (!settingPath) continue
    if (predicate(tablePath, settingPath)) return true
  }
  return false
}

function parseTomlTableHeader(line: string): readonly string[] | null {
  if (!line.startsWith("[") || !line.endsWith("]") || line.startsWith("[[")) return null
  return parseTomlDottedKey(line.slice(1, -1).trim())
}

function isTomlTableHeaderLine(line: string): boolean {
  return line.startsWith("[") && line.endsWith("]")
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

function findUnquotedAssignment(line: string): number {
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
    if (char === "=") return index
    index += 1
  }
  return -1
}
