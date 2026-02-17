// Fix JSON text containing invalid surrogate *escape sequences* like "\uD800"
// without a matching low surrogate. These are technically valid UTF-16 strings
// (the escape chars are normal ASCII), but strict JSON parsers (serde_json,
// Go encoding/json) reject them with "no low surrogate in string".
//
// This complements toWellFormed() which only handles literal surrogate code
// units, not their JSON escape representations.

function hex4ToInt(s: string, idx: number): number {
  let x = 0
  for (let i = 0; i < 4; i++) {
    const c = s.charCodeAt(idx + i)
    let v = -1
    if (c >= 0x30 && c <= 0x39) v = c - 0x30
    else if (c >= 0x41 && c <= 0x46) v = c - 0x41 + 10
    else if (c >= 0x61 && c <= 0x66) v = c - 0x61 + 10
    else return -1
    x = (x << 4) | v
  }
  return x
}

/**
 * Scan JSON text for lone surrogate escape sequences (\uD800-\uDFFF without
 * a valid pair) and replace them with \uFFFD. Valid surrogate pairs like
 * \uD83D\uDE00 are preserved. Only operates inside JSON string literals.
 *
 * Fast-path: returns input unchanged if no \uD or \ud pattern is found.
 */
export function fixJsonSurrogateEscapes(jsonText: string): string {
  if (jsonText.indexOf("\\uD") === -1 && jsonText.indexOf("\\ud") === -1) {
    return jsonText
  }

  let inString = false
  let out: string[] | null = null
  let last = 0

  for (let i = 0; i < jsonText.length; i++) {
    const ch = jsonText.charCodeAt(i)

    if (!inString) {
      if (ch === 0x22 /* " */) inString = true
      continue
    }

    // Inside a JSON string
    if (ch === 0x22 /* " */) {
      inString = false
      continue
    }

    if (ch !== 0x5c /* \ */) continue

    // Backslash escape — skip next char to avoid mis-detecting string end
    const next = jsonText.charCodeAt(i + 1)
    if (next !== 0x75 /* u */) {
      i += 1
      continue
    }

    // \uXXXX escape — need at least 4 hex digits after \u
    if (i + 5 >= jsonText.length) {
      i += 1
      continue
    }

    const code = hex4ToInt(jsonText, i + 2)
    if (code < 0) {
      i += 1
      continue
    }

    const isHigh = code >= 0xd800 && code <= 0xdbff
    const isLow = code >= 0xdc00 && code <= 0xdfff

    if (!isHigh && !isLow) {
      i += 5 // skip past \uXXXX
      continue
    }

    if (isHigh) {
      // Check if followed by a valid low surrogate escape → valid pair
      const j = i + 6
      let validPair = false
      if (
        j + 5 < jsonText.length &&
        jsonText.charCodeAt(j) === 0x5c &&
        jsonText.charCodeAt(j + 1) === 0x75
      ) {
        const code2 = hex4ToInt(jsonText, j + 2)
        if (code2 >= 0xdc00 && code2 <= 0xdfff) validPair = true
      }

      if (validPair) {
        i += 11 // skip \uHHHH\uLLLL pair
        continue
      }

      // Lone high surrogate — replace with \uFFFD
      if (!out) out = []
      out.push(jsonText.slice(last, i))
      out.push("\\uFFFD")
      last = i + 6
      i += 5
      continue
    }

    // Lone low surrogate — replace with \uFFFD
    if (!out) out = []
    out.push(jsonText.slice(last, i))
    out.push("\\uFFFD")
    last = i + 6
    i += 5
  }

  if (!out) return jsonText
  out.push(jsonText.slice(last))
  return out.join("")
}
