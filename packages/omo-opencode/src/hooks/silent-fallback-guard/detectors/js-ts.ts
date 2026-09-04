import type { NormalizedLine } from "../normalize"
import type { FallbackCandidate, FallbackConfidence, FallbackRiskType } from "../types"

const JS_TS_LANGUAGE = "typescript"
const DEFAULT_RETURN_PATTERN = /^return\s+(?:null|undefined|false|true|\[\]|\{\}|<string>|\d+(?:\.\d+)?)(?:;)?$/u
const DEFAULT_VALUE_PATTERN = /(?:null|undefined|false|true|\[\]|\{\}|<string>|\d+(?:\.\d+)?)(?:;)?$/u
const CATCH_PATTERN = /(?:^|\}\s*)catch\s*(?:\([^)]*\))?\s*\{/u

export function detectJsTsFallbacks(lines: NormalizedLine[]): FallbackCandidate[] {
  const candidates: FallbackCandidate[] = []

  for (const line of lines) {
    if (!line.code) {
      continue
    }

    const catchCandidate = detectCatchFallback(line)
    if (catchCandidate) {
      candidates.push(catchCandidate)
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
  const operator = operatorIn(code)
  if (!operator) {
    return undefined
  }

  if (isBooleanControlFlow(code)) {
    return buildCandidate(
      line,
      operator.startsWith("??") ? "NULLISH_FALLBACK" : "DEFAULT_VALUE",
      "low",
      "Boolean control flow uses a fallback-like operator.",
    )
  }

  if (!isValueContext(code, operator)) {
    return undefined
  }

  const riskType = isEnvironmentFallback(code)
    ? "ENV_FALLBACK"
    : operator.startsWith("??")
      ? "NULLISH_FALLBACK"
      : "DEFAULT_VALUE"
  const confidence: FallbackConfidence = riskType === "ENV_FALLBACK" ? "high" : "medium"
  const reason = riskType === "ENV_FALLBACK"
    ? "Environment variable fallback introduces a default value."
    : operator.startsWith("??")
      ? "Nullish fallback introduces a default value."
      : "Logical-or fallback introduces a default value."

  return buildCandidate(line, riskType, confidence, reason)
}

function detectDefaultFallback(line: NormalizedLine): FallbackCandidate | undefined {
  const code = line.normalized
  if (looksLikeDefaultParameter(code)) {
    return buildCandidate(line, "DEFAULT_VALUE", "medium", "Default parameter introduces a fallback value.")
  }

  if (looksLikeDestructuringDefault(code)) {
    return buildCandidate(line, "DEFAULT_VALUE", "medium", "Destructuring default introduces a fallback value.")
  }

  return undefined
}

function detectCatchFallback(line: NormalizedLine): FallbackCandidate | undefined {
  const block = catchBlockFor(line)
  if (!block) {
    return undefined
  }

  const compact = normalizeBlock(block.lines.map((entry) => entry.normalized).join(" "))
  if (!compact.includes("catch")) {
    return undefined
  }

  if (hasRethrow(compact)) {
    return undefined
  }

  if (catchReturnsDefault(compact)) {
    return buildCandidate(
      block.anchor,
      "CATCH_RETURN_DEFAULT",
      "high",
      "Catch block returns a default value instead of propagating the error.",
      block.lines,
    )
  }

  if (isEmptyCatch(compact) || hasCatchBody(compact)) {
    return buildCandidate(
      block.anchor,
      "ERROR_SWALLOW",
      "high",
      "Catch block swallows an error without rethrowing it.",
      block.lines,
    )
  }

  return undefined
}

function operatorIn(code: string): "||=" | "??=" | "||" | "??" | undefined {
  if (code.includes("||=")) {
    return "||="
  }
  if (code.includes("??=")) {
    return "??="
  }
  if (code.includes("||")) {
    return "||"
  }
  if (code.includes("??")) {
    return "??"
  }
  return undefined
}

function isValueContext(code: string, operator: string): boolean {
  if (operator === "||=" || operator === "??=") {
    return true
  }

  return /^(?:const|let|var)\s+[\w${}\[\],:\s]+\s*=/u.test(code)
    || /^return\s+/u.test(code)
    || /^[\w$]+\??\.?[\w$]*\s*=/u.test(code)
    || /[{,]\s*[\w$]+\s*:\s*[^,{}]+(?:\|\||\?\?)/u.test(code)
}

function isBooleanControlFlow(code: string): boolean {
  return /^(?:if|while|for)\s*\(/u.test(code)
}

function isEnvironmentFallback(code: string): boolean {
  return /\bprocess\.env\.[\w$]+\b/u.test(code) || /\bprocess\.env\[[^\]]+\]/u.test(code)
}

function looksLikeDefaultParameter(code: string): boolean {
  return /\b(?:function\s+[\w$]+|constructor|[\w$]+\s*=\s*(?:async\s*)?\([^)]*=|(?:async\s*)?\([^)]*=)[^{;]*\)/u.test(code)
    || /\b(?:function\s+[\w$]+|constructor)\s*\([^)]*\w+\s*=\s*[^,)]+/u.test(code)
}

function looksLikeDestructuringDefault(code: string): boolean {
  return /^(?:const|let|var)\s+(?:\{[^}]*\w+\s*=\s*[^}]+\}|\[[^\]]*\w+\s*=\s*[^\]]+\])\s*=/u.test(code)
}

function catchBlockFor(line: NormalizedLine): { anchor: NormalizedLine; lines: NormalizedLine[] } | undefined {
  const contextLines = [...line.hunkContext, line]
    .filter((entry) => entry.code)
    .sort((left, right) => left.lineNumber - right.lineNumber)
  const catchIndex = contextLines.findIndex((entry) => CATCH_PATTERN.test(entry.normalized))

  if (catchIndex === -1) {
    return undefined
  }

  const lines = contextLines.slice(catchIndex)
  const lineIsInCatch = lines.some((entry) => entry.lineNumber === line.lineNumber)
  if (!lineIsInCatch) {
    return undefined
  }

  return { anchor: contextLines[catchIndex], lines }
}

function normalizeBlock(block: string): string {
  return block.replace(/\s+/gu, " ").trim()
}

function hasRethrow(block: string): boolean {
  return /\bthrow\b/u.test(block)
}

function catchReturnsDefault(block: string): boolean {
  const returnMatch = /\breturn\s+([^;}]*)/u.exec(block)
  if (!returnMatch) {
    return false
  }

  return DEFAULT_RETURN_PATTERN.test(`return ${returnMatch[1].trim()}`) || DEFAULT_VALUE_PATTERN.test(returnMatch[1].trim())
}

function isEmptyCatch(block: string): boolean {
  return /catch\s*(?:\([^)]*\))?\s*\{\s*\}?\s*;?$/u.test(block)
    || /catch\s*(?:\([^)]*\))?\s*\{\s*\}/u.test(block)
}

function hasCatchBody(block: string): boolean {
  const bodyMatch = /catch\s*(?:\([^)]*\))?\s*\{\s*(.*?)\s*\}?\s*$/u.exec(block)
  return Boolean(bodyMatch?.[1]?.trim())
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
    language: JS_TS_LANGUAGE,
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
