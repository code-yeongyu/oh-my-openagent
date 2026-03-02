function normalizeTokens(text: string): string {
  return text.replace(/\s+/g, "")
}

function stripAllWhitespace(text: string): string {
  return normalizeTokens(text)
}

export function stripTrailingContinuationTokens(text: string): string {
  return text.replace(/(?:&&|\|\||\?\?|\?|:|=|,|\+|-|\*|\/|\.|\()\s*$/u, "")
}

export function stripMergeOperatorChars(text: string): string {
  return text.replace(/[|&?]/g, "")
}

function leadingWhitespace(text: string): string {
  if (!text) return ""
  const match = text.match(/^\s*/)
  return match ? match[0] : ""
}

export function restoreOldWrappedLines(originalLines: string[], replacementLines: string[]): string[] {
  if (originalLines.length === 0 || replacementLines.length < 2) return replacementLines

  const canonicalToOriginal = new Map<string, { line: string; count: number }>()
  for (const line of originalLines) {
    const canonical = stripAllWhitespace(line)
    const existing = canonicalToOriginal.get(canonical)
    if (existing) {
      existing.count += 1
    } else {
      canonicalToOriginal.set(canonical, { line, count: 1 })
    }
  }

  const candidates: { start: number; len: number; replacement: string; canonical: string }[] = []
  for (let start = 0; start < replacementLines.length; start += 1) {
    for (let len = 2; len <= 10 && start + len <= replacementLines.length; len += 1) {
      const span = replacementLines.slice(start, start + len)
      if (span.some((line) => line.trim().length === 0)) continue
      const canonicalSpan = stripAllWhitespace(span.join(""))
      const original = canonicalToOriginal.get(canonicalSpan)
      if (original && original.count === 1 && canonicalSpan.length >= 6) {
        candidates.push({ start, len, replacement: original.line, canonical: canonicalSpan })
      }
    }
  }
  if (candidates.length === 0) return replacementLines

  const canonicalCounts = new Map<string, number>()
  for (const candidate of candidates) {
    canonicalCounts.set(candidate.canonical, (canonicalCounts.get(candidate.canonical) ?? 0) + 1)
  }

  const uniqueCandidates = candidates.filter((candidate) => (canonicalCounts.get(candidate.canonical) ?? 0) === 1)
  if (uniqueCandidates.length === 0) return replacementLines

  uniqueCandidates.sort((a, b) => b.start - a.start)
  const correctedLines = [...replacementLines]
  for (const candidate of uniqueCandidates) {
    correctedLines.splice(candidate.start, candidate.len, candidate.replacement)
  }
  return correctedLines
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
    let idx = merged.indexOf(part, offset)
    let matchedLen = part.length
    if (idx === -1) {
      const stripped = stripTrailingContinuationTokens(part)
      if (stripped !== part) {
        idx = merged.indexOf(stripped, offset)
        if (idx !== -1) matchedLen = stripped.length
      }
    }
    if (idx === -1) {
      const segment = merged.slice(offset)
      const segmentStripped = stripMergeOperatorChars(segment)
      const partStripped = stripMergeOperatorChars(part)
      const fuzzyIdx = segmentStripped.indexOf(partStripped)
      if (fuzzyIdx !== -1) {
        let strippedPos = 0
        let originalPos = 0
        while (strippedPos < fuzzyIdx && originalPos < segment.length) {
          if (!/[|&?]/.test(segment[originalPos])) strippedPos += 1
          originalPos += 1
        }
        idx = offset + originalPos
        matchedLen = part.length
      }
    }
    if (idx === -1) {
      orderedMatch = false
      break
    }
    indices.push(idx)
    offset = idx + matchedLen
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
    if (originalLines[idx].trim() === line.trim()) return line
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
