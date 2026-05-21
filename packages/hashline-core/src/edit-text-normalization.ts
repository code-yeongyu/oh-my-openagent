const HASHLINE_PREFIX_RE = /^\s*(?:>>>|>>)?\s*\d+\s*#\s*[ZPMQVRWSNKTXJBYH]{2}\|/
const DIFF_PLUS_RE = /^[+](?![+])/

function equalsIgnoringWhitespace(a: string, b: string): boolean {
  if (a === b) return true
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "")
}

function leadingWhitespace(text: string): string {
  if (!text) return ""
  const match = text.match(/^\s*/)
  return match ? match[0] : ""
}

export function stripLinePrefixes(lines: string[]): string[] {
  let hashPrefixCount = 0
  let diffPlusCount = 0
  let nonEmpty = 0

  for (const line of lines) {
    if (line.length === 0) continue
    nonEmpty += 1
    if (HASHLINE_PREFIX_RE.test(line)) hashPrefixCount += 1
    if (DIFF_PLUS_RE.test(line)) diffPlusCount += 1
  }

  if (nonEmpty === 0) {
    return lines
  }

  const stripHash = hashPrefixCount > 0 && hashPrefixCount >= nonEmpty * 0.5
  const stripPlus = !stripHash && diffPlusCount > 0 && diffPlusCount >= nonEmpty * 0.5

  if (!stripHash && !stripPlus) {
    return lines
  }

  return lines.map((line) => {
    if (stripHash) return line.replace(HASHLINE_PREFIX_RE, "")
    if (stripPlus) return line.replace(DIFF_PLUS_RE, "")
    return line
  })
}

export function toNewLines(input: string | string[]): string[] {
  if (Array.isArray(input)) {
    return stripLinePrefixes(input)
  }
  return stripLinePrefixes(input.split("\n"))
}

export function restoreLeadingIndent(templateLine: string, line: string): string {
  if (line.length === 0) return line
  const templateIndent = leadingWhitespace(templateLine)
  if (templateIndent.length === 0) return line
  if (leadingWhitespace(line).length > 0) return line
  if (templateLine.trim() === line.trim()) return line
  return `${templateIndent}${line}`
}

export function stripInsertAnchorEcho(anchorLine: string, newLines: string[]): string[] {
  if (newLines.length === 0) return newLines
  if (equalsIgnoringWhitespace(newLines[0], anchorLine)) {
    return newLines.slice(1)
  }
  return newLines
}

export function stripInsertBeforeEcho(anchorLine: string, newLines: string[]): string[] {
  if (newLines.length <= 1) return newLines
  if (equalsIgnoringWhitespace(newLines[newLines.length - 1], anchorLine)) {
    return newLines.slice(0, -1)
  }
  return newLines
}

export function stripInsertBoundaryEcho(afterLine: string, beforeLine: string, newLines: string[]): string[] {
  let out = newLines
  if (out.length > 0 && equalsIgnoringWhitespace(out[0], afterLine)) {
    out = out.slice(1)
  }
  if (out.length > 0 && equalsIgnoringWhitespace(out[out.length - 1], beforeLine)) {
    out = out.slice(0, -1)
  }
  return out
}

export function stripRangeBoundaryEcho(
  lines: string[],
  startLine: number,
  endLine: number,
  newLines: string[]
): string[] {
  const replacedCount = endLine - startLine + 1
  if (newLines.length <= 1 || newLines.length <= replacedCount) {
    return newLines
  }

  let out = newLines
  const beforeIdx = startLine - 2
  if (beforeIdx >= 0 && equalsIgnoringWhitespace(out[0], lines[beforeIdx])) {
    out = out.slice(1)
  }

  const afterIdx = endLine
  if (afterIdx < lines.length && out.length > 0 && equalsIgnoringWhitespace(out[out.length - 1], lines[afterIdx])) {
    out = out.slice(0, -1)
  }

  return out
}
