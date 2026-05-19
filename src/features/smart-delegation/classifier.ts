import type { ComplexityClassification, ComplexityLevel } from "./types"

const TRIVIAL_PATTERNS = [
  /\b(?:typo|rename|fix typo|fix comment|add space|remove space|format|prettier|lint)\b/gi,
  /\b(?:single.?file|one.?file|simple.?change|tiny|minor|small.?fix)\b/gi,
  /\b(?:bump|update|version|changelog|readme|README)\b/gi,
]

const COMPLEX_PATTERNS = [
  /\b(?:architect|refactor|redesign|migrate|restructur)\b/gi,
  /\b(?:cross.?cutting|multi.?domain|multi.?file|complex|intricate)\b/gi,
  /\b(?:performance|security|optimize|scalab|distribut)\b/gi,
  /\b(?:design.?pattern|architectur|trade.?off|component.?design)\b/gi,
]

const STANDARD_PATTERNS = [
  /\b(?:feature|implement|add|create|build|new)\b/gi,
  /\b(?:modif|change|update|extend|improve|enhance)\b/gi,
  /\b(?:integra|connec|wire|plugin|module|component)\b/gi,
]

function countLines(prompt: string): number {
  return prompt.split("\n").length
}

function matchScore(prompt: string, patterns: RegExp[]): number {
  return patterns.reduce((score, pattern) => {
    const matches = prompt.match(pattern)
    return score + (matches ? matches.length : 0)
  }, 0)
}

export function classifyTaskComplexity(prompt: string): ComplexityClassification {
  const lineCount = countLines(prompt)
  const trivialScore = matchScore(prompt, TRIVIAL_PATTERNS)
  const complexScore = matchScore(prompt, COMPLEX_PATTERNS)
  const standardScore = matchScore(prompt, STANDARD_PATTERNS)

  let level: ComplexityLevel
  let reason: string

  if (complexScore >= 2 || (complexScore >= 1 && lineCount > 50)) {
    level = "complex"
    reason = `Detected ${complexScore} complex pattern(s) with ${lineCount} lines`
  } else if ((trivialScore >= 1 && lineCount < 30) || (trivialScore >= 2)) {
    level = "trivial"
    reason = `Detected ${trivialScore} trivial pattern(s) with ${lineCount} lines`
  } else if (standardScore >= 1 || lineCount >= 10) {
    level = "standard"
    reason = `Detected ${standardScore} standard pattern(s) with ${lineCount} lines`
  } else {
    level = "standard"
    reason = `No strong signals found, defaulting to standard complexity (${lineCount} lines)`
  }

  return { level, reason }
}
