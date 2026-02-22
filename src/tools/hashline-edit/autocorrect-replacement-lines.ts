function normalizeTokens(text: string): string {
  return text.replace(/\s+/g, "")
}

function leadingWhitespace(text: string): string {
  const match = text.match(/^\s*/)
  return match ? match[0] : ""
}

export function restoreOldWrappedLines(originalLines: string[], replacementLines: string[]): string[] {
  if (replacementLines.length <= 1) return replacementLines
  if (originalLines.length !== replacementLines.length) return replacementLines
  const original = normalizeTokens(originalLines.join("\n"))
  const replacement = normalizeTokens(replacementLines.join("\n"))
  if (original !== replacement) return replacementLines
  return originalLines
}

export function maybeExpandSingleLineMerge(
  originalLines: string[],
  replacementLines: string[]
): string[] {
  if (replacementLines.length !== 1 || originalLines.length <= 1) {
    return replacementLines
  }

  const merged = replacementLines[0]
  const parts = originalLines.map((line) => line.trim()).filter((line) => line.length > 0)
  if (parts.length !== originalLines.length) return replacementLines

  const indices: number[] = []
  let offset = 0
  let orderedMatch = true
  for (const part of parts) {
    const idx = merged.indexOf(part, offset)
    if (idx === -1) {
      orderedMatch = false
      break
    }
    indices.push(idx)
    offset = idx + part.length
  }

  const expanded: string[] = []
  if (orderedMatch) {
    for (let i = 0; i < indices.length; i += 1) {
      const start = indices[i]
      const end = i + 1 < indices.length ? indices[i + 1] : merged.length
      const candidate = merged.slice(start, end).trim()
      if (candidate.length === 0) {
        orderedMatch = false
        break
      }
      expanded.push(candidate)
    }
  }

  if (orderedMatch && expanded.length === originalLines.length) {
    return expanded
  }

  const semicolonSplit = merged
    .split(/;\s+/)
    .map((line, idx, arr) => {
      if (idx < arr.length - 1 && !line.endsWith(";")) {
        return `${line};`
      }
      return line
    })
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (semicolonSplit.length === originalLines.length) {
    return semicolonSplit
  }

  return replacementLines
}

export function restoreIndentForPairedReplacement(
  originalLines: string[],
  replacementLines: string[]
): string[] {
  if (originalLines.length !== replacementLines.length) {
    return replacementLines
  }

  return replacementLines.map((line, idx) => {
    if (line.length === 0) return line
    if (leadingWhitespace(line).length > 0) return line
    const indent = leadingWhitespace(originalLines[idx])
    if (indent.length === 0) return line
    return `${indent}${line}`
  })
}

export function autocorrectReplacementLines(
  originalLines: string[],
  replacementLines: string[]
): string[] {
  let next = replacementLines
  next = maybeExpandSingleLineMerge(originalLines, next)
  next = restoreOldWrappedLines(originalLines, next)
  next = restoreIndentForPairedReplacement(originalLines, next)
  return next
}
