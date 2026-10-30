// Mirror of the parts of senpi-ai `utils/secret-lexer` (2026.10.27-2, senpi#4283) that the credential-shape pass reads:
// character classes, percent escapes and HTML entities read as what they encode, and the token unit. Every function
// reads forward from the index it is given; none searches back or uses a regular expression.

interface Unit {
  character: number
  length: number
  refusal?: "percent-window"
}

const HTML_ENTITIES: ReadonlyArray<readonly [string, number]> = [
  ["&quot;", 34],
  ["&#34;", 34],
  ["&#034;", 34],
  ["&#x22;", 34],
  ["&#39;", 39],
  ["&#039;", 39],
  ["&#x27;", 39],
  ["&lt;", 60],
  ["&gt;", 62],
  ["&amp;", 38],
]
const PERCENT_WINDOW = 64

export const isDigit = (c: number): boolean => c >= 48 && c <= 57
export const isUpper = (c: number): boolean => c >= 65 && c <= 90
const isLower = (c: number): boolean => c >= 97 && c <= 122
export const isAlnum = (c: number): boolean => isDigit(c) || isUpper(c) || isLower(c)
export const isBase64Url = (c: number): boolean => isAlnum(c) || c === 95 || c === 45
const isNameChar = (c: number): boolean => isBase64Url(c) || c === 46
const isTokenChar = (c: number): boolean => isNameChar(c) || c === 43 || c === 47 || c === 126

function hexValue(c: number): number {
  if (isDigit(c)) return c - 48
  if (c >= 65 && c <= 70) return c - 55
  if (c >= 97 && c <= 102) return c - 87
  return -1
}

export function matchesAt(text: string, i: number, literal: string, limit = text.length): boolean {
  if (i + literal.length > limit) return false
  for (let k = 0; k < literal.length; k++) if (text.charCodeAt(i + k) !== literal.charCodeAt(k)) return false
  return true
}

/** The length of the token unit at i (a value character, or a percent escape of one), or 0 at a delimiter. */
export function tokenUnitLength(text: string, i: number): number {
  const c = text.charCodeAt(i)
  if (isTokenChar(c)) return 1
  if (c !== 37) return 0
  const unit = readUnit(text, i)
  if (unit.refusal !== undefined) return 0
  return isTokenChar(unit.character) || unit.length === 1 ? unit.length : 0
}

/**
 * Repeated full-window percent decoding to a fixpoint, keeping each character's original source end.
 * A pass shrinks the 64-character window by at least two, so both work and storage here are bounded.
 * Malformed escapes are literal, but an unfinished escape at the window edge is not a proven boundary.
 */
function percentWindow(text: string, start: number, prefixEnd: number): Unit {
  const limit = Math.min(text.length, prefixEnd + PERCENT_WINDOW - 1)
  let needsDecoding = false
  let contiguous = true
  let previous = 37
  for (let p = prefixEnd; p < limit; p++) {
    const c = text.charCodeAt(p)
    const hex = hexValue(c) >= 0
    if (previous === 37 && hex) {
      needsDecoding = true
      break
    }
    if (c !== 37 && !hex) contiguous = false
    previous = c
  }
  // Without a possible escape no pass can change the window, so do not allocate its fixpoint buffers.
  if (!needsDecoding) {
    if (contiguous && limit < text.length) return { character: 37, length: limit - start, refusal: "percent-window" }
    return { character: 37, length: prefixEnd - start }
  }
  const characters = [37]
  const ends = [prefixEnd]
  for (let p = prefixEnd; p < limit; p++) {
    characters.push(text.charCodeAt(p))
    ends.push(p + 1)
  }
  let changed: boolean
  do {
    changed = false
    let written = 0
    for (let p = 0; p < characters.length; p++) {
      let c = characters[p] ?? 0
      const high = hexValue(characters[p + 1] ?? -1)
      const low = hexValue(characters[p + 2] ?? -1)
      if (c === 37 && high >= 0 && low >= 0) {
        c = high * 16 + low
        p += 2
        changed = true
      }
      characters[written] = c
      ends[written++] = ends[p] ?? prefixEnd
    }
    characters.length = written
    ends.length = written
  } while (changed)
  const character = characters[0] ?? 37
  if (character === 37 && limit < text.length) {
    // Only a contiguous percent/hex run can depend on text beyond the window. A non-hex literal
    // breaks the dependency: the percent before it can never decode on any later pass.
    for (let p = 1; p < characters.length; p++) {
      const c = characters[p] ?? 0
      if (c !== 37 && hexValue(c) < 0) return { character, length: (ends[0] ?? prefixEnd) - start }
    }
    return { character, length: limit - start, refusal: "percent-window" }
  }
  return { character, length: (ends[0] ?? prefixEnd) - start }
}

/** One logical character and its full source width, shared by token, delimiter and word-boundary scans. */
export function readUnit(text: string, i: number): Unit {
  const c = text.charCodeAt(i)
  if (c === 37) {
    let end = i + 1
    let decoded = c
    // Collapse literal %25 layers in one forward walk before the bounded full-window decoder.
    // This is the fixpoint of that prefix, not a depth cap: even million-layer canonical chains stay linear.
    while (end + 1 < text.length) {
      const high = hexValue(text.charCodeAt(end))
      const low = hexValue(text.charCodeAt(end + 1))
      if (high < 0 || low < 0) break
      decoded = high * 16 + low
      end += 2
      if (decoded !== 37) return { character: decoded, length: end - i }
    }
    return percentWindow(text, i, end)
  }
  if (c === 38) {
    for (const [entity, character] of HTML_ENTITIES) {
      if (matchesAt(text, i, entity)) return { character, length: entity.length }
    }
  }
  if (c === 0xff1a) return { character: 58, length: 1 }
  if (c === 0x201c || c === 0x201d) return { character: 34, length: 1 }
  if (c === 0x2018 || c === 0x2019) return { character: 39, length: 1 }
  return { character: c, length: 1 }
}

/**
 * The delimiter that starts at i, as far as the shape pass reads it (senpi-ai `readDelimiter`'s `end` and
 * `refusalStart`): its end, and where a bounded percent-decoder refusal begins (-1 when none, the end is then the text's).
 */
export function readDelimiterEnd(text: string, i: number): { end: number; refusalStart: number } {
  let position = i
  while (position < text.length && tokenUnitLength(text, position) === 0) {
    const unit = readUnit(text, position)
    if (unit.refusal !== undefined) return { end: text.length, refusalStart: position }
    position += unit.length
  }
  return { end: position, refusalStart: -1 }
}
