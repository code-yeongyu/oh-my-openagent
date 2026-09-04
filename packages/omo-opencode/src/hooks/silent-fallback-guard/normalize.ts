// V1 is lexical and single-line; complex multiline semantics are deferred to AST work.
export interface NormalizedLine {
  raw: string
  code: string
  normalized: string
  comment?: string
  language?: string
  file: string
  lineNumber: number
  hunkContext: NormalizedLine[]
}

export interface NormalizeDiffOptions {
  language?: string
  contextRadius?: number
}

interface ParsedHunkLine extends NormalizedLine {
  hunkIndex: number
  isAdded: boolean
}

const DEFAULT_CONTEXT_RADIUS = 3

export function normalizeDiffPatch(
  patchText: string,
  options: NormalizeDiffOptions = {},
): NormalizedLine[] {
  const contextRadius = options.contextRadius ?? DEFAULT_CONTEXT_RADIUS
  const parsedLines: ParsedHunkLine[] = []
  let currentFile = ""
  let newLineNumber = 0
  let hunkIndex = -1

  for (const line of patchText.split("\n")) {
    if (line.startsWith("+++ ")) {
      currentFile = normalizeDiffFilePath(line.slice(4))
      continue
    }

    const hunkMatch = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line)
    if (hunkMatch) {
      newLineNumber = Number(hunkMatch[1])
      hunkIndex += 1
      continue
    }

    if (hunkIndex < 0 || line.startsWith("--- ")) {
      continue
    }

    if (line.startsWith("+") && !line.startsWith("+++ ")) {
      const raw = line.slice(1)
      const language = options.language ?? inferLanguageFromFile(currentFile)
      const normalized = normalizeLine(raw, language)
      parsedLines.push({
        raw,
        code: normalized.code,
        normalized: normalized.normalized,
        comment: normalized.comment,
        language,
        file: currentFile,
        lineNumber: newLineNumber,
        hunkContext: [],
        hunkIndex,
        isAdded: true,
      })
      newLineNumber += 1
      continue
    }

    if (line.startsWith(" ")) {
      const raw = line.slice(1)
      const language = options.language ?? inferLanguageFromFile(currentFile)
      const normalized = normalizeLine(raw, language)
      parsedLines.push({
        raw,
        code: normalized.code,
        normalized: normalized.normalized,
        comment: normalized.comment,
        language,
        file: currentFile,
        lineNumber: newLineNumber,
        hunkContext: [],
        hunkIndex,
        isAdded: false,
      })
      newLineNumber += 1
      continue
    }

    if (line.startsWith("-") && !line.startsWith("--- ")) {
      continue
    }
  }

  const addedLines = parsedLines.filter((line) => line.isAdded)
  for (const line of addedLines) {
    line.hunkContext = parsedLines
      .filter((candidate) => candidate.hunkIndex === line.hunkIndex)
      .filter((candidate) => Math.abs(candidate.lineNumber - line.lineNumber) <= contextRadius)
      .filter((candidate) => candidate !== line)
      .map(stripInternalHunkIndex)
  }

  return addedLines.map(stripInternalHunkIndex)
}

export function normalizeLine(
  line: string,
  language: string,
): { code: string; comment?: string; normalized: string } {
  const commentStart = findCommentStart(line, language)
  const codeSource = commentStart === undefined ? line : line.slice(0, commentStart)
  const commentSource = commentStart === undefined ? undefined : line.slice(commentStart).trim()
  const code = normalizeWhitespace(maskStringLiterals(codeSource, language))

  return {
    code,
    normalized: code,
    ...(commentSource ? { comment: commentSource } : {}),
  }
}

function normalizeDiffFilePath(path: string): string {
  const trimmed = path.trim().split(/\s+/)[0] ?? ""
  if (trimmed === "/dev/null") {
    return trimmed
  }
  return trimmed.replace(/^b\//, "")
}

function stripInternalHunkIndex(line: ParsedHunkLine): NormalizedLine {
  const { hunkIndex: _hunkIndex, isAdded: _isAdded, ...normalizedLine } = line
  return normalizedLine
}

function normalizeWhitespace(value: string): string {
  return value.replace(/[\t ]+/g, " ").trim()
}

function findCommentStart(line: string, language: string): number | undefined {
  const markers = commentMarkersForLanguage(language)
  let quote: string | undefined
  let escaped = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === quote) {
        quote = undefined
      }
      continue
    }

    if (char === "\"" || char === "'" || (char === "`" && supportsBacktickStrings(language))) {
      quote = char
      continue
    }

    for (const marker of markers) {
      if (line.startsWith(marker, index)) {
        return index
      }
    }
  }

  return undefined
}

function maskStringLiterals(line: string, language: string): string {
  let output = ""
  let quote: string | undefined
  let escaped = false
  let emittedMask = false

  for (const char of line) {
    if (quote) {
      if (!emittedMask) {
        output += "<string>"
        emittedMask = true
      }
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === quote) {
        quote = undefined
        emittedMask = false
      }
      continue
    }

    if (char === "\"" || char === "'" || (char === "`" && supportsBacktickStrings(language))) {
      quote = char
      emittedMask = false
      continue
    }

    output += char
  }

  return output
}

function commentMarkersForLanguage(language: string): string[] {
  if (language === "python") {
    return ["#"]
  }
  return ["//"]
}

function supportsBacktickStrings(language: string): boolean {
  return language === "javascript" || language === "typescript"
}

function inferLanguageFromFile(file: string): string {
  if (/\.py$/u.test(file)) {
    return "python"
  }
  if (/\.[cm]?js$/u.test(file) || /\.jsx$/u.test(file)) {
    return "javascript"
  }
  return "typescript"
}
