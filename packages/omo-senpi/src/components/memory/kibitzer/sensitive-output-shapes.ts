// Mirror of senpi-ai `redactCredentialShapes` (2026.10.30-1, senpi#4283: `utils/secret-redaction` in its shapes-only
// mode plus the key-prefix and JWT rules of `utils/secret-classifier`). The text is read once, left to right, as
// alternating tokens and delimiters; a token is replaced from where a known key prefix or a JWT starts a word in it.
// No regular expressions, linear in the input.

import { isAlnum, isBase64Url, isDigit, isUpper, matchesAt, readDelimiterEnd, readUnit, tokenUnitLength } from "./sensitive-output-lexer"

interface PrefixRule {
  prefixes: readonly string[]
  min: number
  chars: (c: number) => boolean
  exact?: boolean
}

const isUpperOrDigit = (c: number): boolean => isDigit(c) || isUpper(c)
const isSlackChar = (c: number): boolean => isAlnum(c) || c === 45
const isPatChar = (c: number): boolean => isAlnum(c) || c === 95
const isWordChar = (c: number): boolean => isAlnum(c) || c === 95

/** Credential-shaped tokens recognized by their prefix wherever a word starts with it. */
const PREFIX_RULES: readonly PrefixRule[] = [
  { prefixes: ["sk-"], min: 8, chars: isBase64Url },
  { prefixes: ["sk_live_", "sk_test_", "rk_live_", "rk_test_"], min: 16, chars: isAlnum },
  { prefixes: ["gsk_", "xai-", "hf_"], min: 20, chars: isAlnum },
  { prefixes: ["xoxa-", "xoxb-", "xoxo-", "xoxp-", "xoxr-", "xoxs-"], min: 10, chars: isSlackChar },
  { prefixes: ["ghp_", "gho_", "ghu_", "ghs_", "ghr_"], min: 20, chars: isAlnum },
  { prefixes: ["github_pat_"], min: 20, chars: isPatChar },
  { prefixes: ["AKIA", "ASIA"], min: 16, chars: isUpperOrDigit, exact: true },
  { prefixes: ["AIza"], min: 30, chars: isBase64Url },
]

/** Bounded work: the prefix plus at most min + 1 characters after it. */
function matchesPrefixRule(text: string, start: number, end: number, rule: PrefixRule): boolean {
  for (const prefix of rule.prefixes) {
    if (!matchesAt(text, start, prefix, end)) continue
    let run = 0
    const limit = rule.exact === true ? rule.min + 1 : rule.min
    for (let i = start + prefix.length; i < end && run < limit && rule.chars(text.charCodeAt(i)); i++) run++
    return rule.exact === true ? run === rule.min : run >= rule.min
  }
  return false
}

/** A known key ends at its alphabet's boundary, not at the end of a URL or filename containing it. */
function credentialShapeEnd(text: string, start: number, end: number): number {
  for (const rule of PREFIX_RULES) {
    if (!matchesPrefixRule(text, start, end, rule)) continue
    for (const prefix of rule.prefixes) {
      if (!matchesAt(text, start, prefix, end)) continue
      let i = start + prefix.length
      while (i < end) {
        const unit = readUnit(text, i)
        if (!rule.chars(unit.character)) break
        i += unit.length
      }
      return i
    }
  }
  // JWTs have their own segment grammar; retain the conservative span for those.
  return end
}

/** Whether a JWT ("eyJ" header, three base64url segments) starts at p: -1 when one does, else where the next may. */
function jwtAt(text: string, p: number, end: number): number {
  if (!matchesAt(text, p, "eyJ", end)) return p + 1
  let segments = 1
  let length = 0
  let firstDot = -1
  let i = p
  for (; i < end; ) {
    const unit = readUnit(text, i)
    const c = unit.character
    if (c === 46) {
      if (firstDot < 0) firstDot = i
      const next = i + unit.length < end ? readUnit(text, i + unit.length).character : 0
      if (segments === 3) return length >= 5 && !isBase64Url(next) ? -1 : firstDot
      if (length < (segments === 1 ? 8 : 5)) return firstDot
      segments++
      length = 0
    } else if (isBase64Url(c)) length++
    else break
    i += unit.length
  }
  if (segments === 3 && length >= 5) return -1
  return firstDot >= 0 ? firstDot : i
}

/** Where the first credential-shaped run in [start, end) begins, or -1; withinCredential also checks inside words. */
function credentialShapeStart(text: string, start: number, end: number, withinCredential = false): number {
  let stop = end
  while (stop > start && text.charCodeAt(stop - 1) === 46) stop--
  let jwtFrom = start
  let wordStart = true
  for (let p = start; p < stop; ) {
    const unit = readUnit(text, p)
    const candidate = withinCredential || wordStart
    wordStart = !isWordChar(unit.character)
    const position = p
    p += unit.length
    if (!candidate) continue
    for (const rule of PREFIX_RULES) if (matchesPrefixRule(text, position, stop, rule)) return position
    if (position < jwtFrom) continue
    const next = jwtAt(text, position, stop)
    if (next < 0) return position
    jwtFrom = next
  }
  return -1
}

/** Append [start, end) to the sorted, disjoint ranges, merging what it overlaps. */
function addRange(ranges: number[], start: number, end: number): void {
  let stop = end
  while (ranges.length > 0 && (ranges[ranges.length - 2] ?? 0) >= start) {
    stop = Math.max(stop, ranges[ranges.length - 1] ?? 0)
    ranges.length -= 2
  }
  if (ranges.length > 0 && (ranges[ranges.length - 1] ?? 0) >= start) {
    ranges[ranges.length - 1] = Math.max(ranges[ranges.length - 1] ?? 0, stop)
  } else ranges.push(start, stop)
}

function shapeRanges(text: string): number[] {
  const ranges: number[] = []
  const leading = readDelimiterEnd(text, 0)
  if (leading.refusalStart >= 0) return [leading.refusalStart, text.length]
  let i = leading.end
  while (i < text.length) {
    const start = i
    while (i < text.length) {
      const length = tokenUnitLength(text, i)
      if (length === 0) break
      i += length
    }
    const end = i
    const after = readDelimiterEnd(text, end)
    i = after.end
    if (after.refusalStart >= 0) {
      // Do not let a bounded decoder refusal expose an earlier shape.
      addRange(ranges, start, text.length)
      break
    }
    const shape = credentialShapeStart(text, start, end)
    if (shape < 0) continue
    // A second prefix can begin inside the first alphabet; keep the whole token for joined credentials.
    const joined = credentialShapeStart(text, shape + readUnit(text, shape).length, end, true)
    addRange(ranges, shape, joined >= 0 ? end : credentialShapeEnd(text, shape, end))
  }
  return ranges
}

/** Mask only credential-shaped runs (known key prefixes and JWTs), whatever surrounds them. One linear pass. */
export function redactCredentialShapes(text: string, replacement = "[REDACTED]"): string {
  const ranges = shapeRanges(text)
  if (ranges.length === 0) return text
  const out: string[] = []
  let copied = 0
  for (let k = 0; k < ranges.length; k += 2) {
    out.push(text.slice(copied, ranges[k]), replacement)
    copied = ranges[k + 1] ?? copied
  }
  out.push(text.slice(copied))
  return out.join("")
}
