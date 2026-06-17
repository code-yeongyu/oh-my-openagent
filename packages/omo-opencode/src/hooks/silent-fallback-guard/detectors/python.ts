import type { NormalizedLine } from "../normalize"
import type { FallbackCandidate, FallbackConfidence, FallbackRiskType } from "../types"

const PYTHON_LANGUAGE = "python"
const PYTHON_DEFAULT_RETURN_PATTERN = /^return\s+(?:None|False|True|\[\]|\{\}|<string>|\d+(?:\.\d+)?)$/u
const PYTHON_DEFAULT_VALUE_PATTERN = /^(?:None|False|True|\[\]|\{\}|<string>|\d+(?:\.\d+)?)$/u
const EXCEPT_PATTERN = /^except(?:\s+(?:Exception|BaseException|[^:]+))?:/u
const BROAD_EXCEPT_PATTERN = /^except(?:\s+(?:Exception|BaseException))?:/u

export function detectPythonFallbacks(lines: NormalizedLine[]): FallbackCandidate[] {
  const candidates: FallbackCandidate[] = []

  for (const line of lines) {
    if (!line.code) {
      continue
    }

    const exceptCandidate = detectExceptFallback(line)
    if (exceptCandidate) {
      candidates.push(exceptCandidate)
      continue
    }

    const operatorCandidate = detectOperatorFallback(line)
    if (operatorCandidate) {
      candidates.push(operatorCandidate)
      continue
    }

    const defaultCandidate = detectDefaultFallback(line)
    if (defaultCandidate) {
      candidates.push(defaultCandidate)
    }
  }

  return dedupeCandidates(candidates)
}

function detectOperatorFallback(line: NormalizedLine): FallbackCandidate | undefined {
  const code = line.normalized
  if (!hasLogicalOr(code)) {
    return undefined
  }

  if (isBooleanControlFlow(code)) {
    return buildCandidate(
      line,
      "DEFAULT_VALUE",
      "low",
      "Boolean control flow uses a fallback-like operator.",
    )
  }

  if (!isValueContext(code)) {
    return undefined
  }

  const riskType = isEnvironmentFallback(code) ? "ENV_FALLBACK" : "DEFAULT_VALUE"
  const confidence: FallbackConfidence = riskType === "ENV_FALLBACK" ? "high" : "medium"
  const reason = riskType === "ENV_FALLBACK"
    ? "Environment variable fallback introduces a default value."
    : "Logical-or fallback introduces a default value."

  return buildCandidate(line, riskType, confidence, reason)
}

function detectDefaultFallback(line: NormalizedLine): FallbackCandidate | undefined {
  const code = line.normalized
  if (looksLikeGetDefault(code)) {
    const riskType = isEnvironmentFallback(code) ? "ENV_FALLBACK" : "DEFAULT_VALUE"
    const confidence: FallbackConfidence = riskType === "ENV_FALLBACK" ? "high" : "medium"
    const reason = riskType === "ENV_FALLBACK"
      ? "Environment variable lookup supplies a default value."
      : "Lookup call supplies a default value."

    return buildCandidate(line, riskType, confidence, reason)
  }

  if (looksLikeDefaultParameter(code)) {
    return buildCandidate(line, "DEFAULT_VALUE", "medium", "Default parameter introduces a fallback value.")
  }

  return undefined
}

function detectExceptFallback(line: NormalizedLine): FallbackCandidate | undefined {
  const block = exceptBlockFor(line)
  if (!block) {
    return undefined
  }

  const compact = normalizeBlock(block.lines.map((entry) => entry.normalized).join(" "))
  if (!compact.includes("except") || hasReraise(compact)) {
    return undefined
  }

  if (exceptReturnsDefault(compact)) {
    return buildCandidate(
      block.anchor,
      "CATCH_RETURN_DEFAULT",
      "high",
      "Except block returns a default value instead of propagating the error.",
      block.lines,
    )
  }

  if (exceptPasses(compact) && isBroadExcept(block.anchor.normalized)) {
    return buildCandidate(
      block.anchor,
      "ERROR_SWALLOW",
      "high",
      "Except block swallows an error without re-raising it.",
      block.lines,
    )
  }

  return undefined
}

function hasLogicalOr(code: string): boolean {
  return /\bor\b/u.test(code)
}

function isValueContext(code: string): boolean {
  return /^return\s+/u.test(code)
    || /^[\w.\[\]'"]+\s*=\s*.+\bor\b/u.test(code)
}

function isBooleanControlFlow(code: string): boolean {
  return /^(?:if|while|elif)\s+/u.test(code)
}

function isEnvironmentFallback(code: string): boolean {
  return /\bos\.getenv\s*\(/u.test(code)
    || /\bos\.environ\.get\s*\(/u.test(code)
}

function looksLikeGetDefault(code: string): boolean {
  return /\b(?:[\w.]+\.get|getattr|os\.getenv|os\.environ\.get)\s*\([^)]*,\s*[^,)]+(?:,\s*[^)]+)?\)/u.test(code)
}

function looksLikeDefaultParameter(code: string): boolean {
  return /^def\s+\w+\s*\([^)]*\w+\s*=\s*[^,)]+/u.test(code)
}

function exceptBlockFor(line: NormalizedLine): { anchor: NormalizedLine; lines: NormalizedLine[] } | undefined {
  const contextLines = [...line.hunkContext, line]
    .filter((entry) => entry.code)
    .sort((left, right) => left.lineNumber - right.lineNumber)
  const exceptIndex = contextLines.findIndex((entry) => EXCEPT_PATTERN.test(entry.normalized))

  if (exceptIndex === -1) {
    return undefined
  }

  const lines = contextLines.slice(exceptIndex)
  const lineIsInExcept = lines.some((entry) => entry.lineNumber === line.lineNumber)
  if (!lineIsInExcept) {
    return undefined
  }

  return { anchor: contextLines[exceptIndex], lines }
}

function normalizeBlock(block: string): string {
  return block.replace(/\s+/gu, " ").trim()
}

function hasReraise(block: string): boolean {
  return /\braise\b/u.test(block)
}

function exceptReturnsDefault(block: string): boolean {
  const returnMatch = /\breturn\s+([^\s][^;]*)$/u.exec(block) ?? /\breturn\s+([^\s]+(?:\s*\[\]|\s*\{\})?)/u.exec(block)
  if (!returnMatch) {
    return false
  }

  const value = returnMatch[1].trim()
  return PYTHON_DEFAULT_RETURN_PATTERN.test(`return ${value}`) || PYTHON_DEFAULT_VALUE_PATTERN.test(value)
}

function exceptPasses(block: string): boolean {
  return /\bpass\b/u.test(block)
}

function isBroadExcept(code: string): boolean {
  return BROAD_EXCEPT_PATTERN.test(code)
}

function buildCandidate(
  line: NormalizedLine,
  riskType: FallbackRiskType,
  confidence: FallbackConfidence,
  reason: string,
  snippetLines: NormalizedLine[] = [line],
): FallbackCandidate {
  const normalized = snippetLines.map((entry) => entry.normalized).join(" ").replace(/\s+/gu, " ").trim()
  const raw = snippetLines.map((entry) => entry.raw).join("\n")

  return {
    file: line.file,
    line: line.lineNumber,
    language: PYTHON_LANGUAGE,
    riskType,
    confidence,
    raw,
    normalized,
    reason,
    groupingKey: groupingKey(normalized || line.normalized, riskType),
    ...(line.comment ? { commentContext: line.comment } : {}),
  }
}

function dedupeCandidates(candidates: FallbackCandidate[]): FallbackCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.file}:${candidate.line}:${candidate.riskType}:${candidate.groupingKey}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function groupingKey(normalized: string, riskType: FallbackRiskType): string {
  return `${riskType}:${normalized.toLowerCase().replace(/\s+/gu, " ")}`
}
