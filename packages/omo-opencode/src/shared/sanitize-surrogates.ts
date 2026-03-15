const REPLACEMENT_CHAR = "\uFFFD"

function isHexDigit(char: string): boolean {
  return /^[0-9a-fA-F]$/.test(char)
}

function readUnicodeEscape(input: string, startIndex: number): { raw: string; codePoint: number } | null {
  if (input.slice(startIndex, startIndex + 2) !== "\\u") {
    return null
  }

  const hex = input.slice(startIndex + 2, startIndex + 6)
  if (hex.length !== 4 || !hex.split("").every(isHexDigit)) {
    return null
  }

  return {
    raw: input.slice(startIndex, startIndex + 6),
    codePoint: Number.parseInt(hex, 16),
  }
}

function isHighSurrogate(codePoint: number): boolean {
  return codePoint >= 0xd800 && codePoint <= 0xdbff
}

function isLowSurrogate(codePoint: number): boolean {
  return codePoint >= 0xdc00 && codePoint <= 0xdfff
}

function legacyToWellFormed(input: string): string {
  let result = ""

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)

    if (!isHighSurrogate(code) && !isLowSurrogate(code)) {
      result += input[index] ?? ""
      continue
    }

    if (isHighSurrogate(code)) {
      const nextCode = index + 1 < input.length ? input.charCodeAt(index + 1) : NaN
      if (isLowSurrogate(nextCode)) {
        result += input[index] ?? ""
        result += input[index + 1] ?? ""
        index += 1
        continue
      }

      result += REPLACEMENT_CHAR
      continue
    }

    result += REPLACEMENT_CHAR
  }

  return result
}

export function fixJsonSurrogateEscapes(input: string): string {
  let result = ""
  let index = 0

  while (index < input.length) {
    const unicodeEscape = readUnicodeEscape(input, index)
    if (!unicodeEscape) {
      result += input[index] ?? ""
      index += 1
      continue
    }

    if (isHighSurrogate(unicodeEscape.codePoint)) {
      const nextEscape = readUnicodeEscape(input, index + 6)
      if (nextEscape && isLowSurrogate(nextEscape.codePoint)) {
        result += unicodeEscape.raw + nextEscape.raw
        index += 12
        continue
      }

      result += "\\uFFFD"
      index += 6
      continue
    }

    if (isLowSurrogate(unicodeEscape.codePoint)) {
      result += "\\uFFFD"
      index += 6
      continue
    }

    result += unicodeEscape.raw
    index += 6
  }

  return result
}

export function sanitizeSurrogates(input: string): string {
  const escapedFixed = fixJsonSurrogateEscapes(input)
  const maybeIsWellFormed = (String.prototype as { isWellFormed?: (this: string) => boolean }).isWellFormed
  const maybeToWellFormed = (String.prototype as { toWellFormed?: (this: string) => string }).toWellFormed

  if (typeof maybeIsWellFormed === "function" && typeof maybeToWellFormed === "function") {
    if (maybeIsWellFormed.call(escapedFixed)) {
      return escapedFixed
    }
    return maybeToWellFormed.call(escapedFixed)
  }

  return legacyToWellFormed(escapedFixed)
}
