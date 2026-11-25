import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

type OccurrenceStyle = NonNullable<NonNullable<OmoTaskSettings["nicknames"]>["occurrence_style"]>

const MAX_NICKNAME_LENGTH = 32
const SMALL_CARDINALS = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
]
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]
const SCALES = ["", "Thousand", "Million", "Billion", "Trillion", "Quadrillion"]
const ORDINALS: Readonly<Record<string, string>> = {
  One: "First",
  Two: "Second",
  Three: "Third",
  Five: "Fifth",
  Eight: "Eighth",
  Nine: "Ninth",
  Twelve: "Twelfth",
  Twenty: "Twentieth",
  Thirty: "Thirtieth",
  Forty: "Fortieth",
  Fifty: "Fiftieth",
  Sixty: "Sixtieth",
  Seventy: "Seventieth",
  Eighty: "Eightieth",
  Ninety: "Ninetieth",
  Hundred: "Hundredth",
  Thousand: "Thousandth",
  Million: "Millionth",
  Billion: "Billionth",
  Trillion: "Trillionth",
  Quadrillion: "Quadrillionth",
}

export function formatTaskNickname(
  base: string,
  occurrence: number,
  style: NonNullable<NonNullable<OmoTaskSettings["nicknames"]>["occurrence_style"]>,
): string {
  if (!Number.isSafeInteger(occurrence) || occurrence < 1) {
    throw new RangeError("Task nickname occurrence must be a positive safe integer")
  }
  if (occurrence === 1) return fitNickname(base, "")

  const preferred = `${base}${occurrenceSuffix(occurrence, style)}`
  if (preferred.length <= MAX_NICKNAME_LENGTH) return preferred

  const numeric = `${base} #${occurrence}`
  if (numeric.length <= MAX_NICKNAME_LENGTH) return numeric
  return fitNickname(base, ` #${occurrence}`)
}

function occurrenceSuffix(occurrence: number, style: OccurrenceStyle): string {
  switch (style) {
    case "#":
      return ` #${occurrence}`
    case "roman":
      return occurrence > 3999 ? ` #${occurrence}` : ` ${toRoman(occurrence)}`
    case "full":
      return ` the ${toEnglishOrdinal(occurrence)}`
    case "arabic":
      return ` the ${occurrence}${ordinalSuffix(occurrence)}`
  }
}

function fitNickname(base: string, suffix: string): string {
  const available = MAX_NICKNAME_LENGTH - suffix.length
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
  const segments: string[] = []
  let prefix = ""
  for (const { segment } of segmenter.segment(base)) {
    if (prefix.length + segment.length > available) {
      while (segments.length > 0 && /^\s+$/u.test(segments.at(-1) ?? "")) {
        const trailingWhitespace = segments.pop()
        if (trailingWhitespace !== undefined) prefix = prefix.slice(0, -trailingWhitespace.length)
      }
      break
    }
    segments.push(segment)
    prefix += segment
  }
  return `${prefix}${suffix}`
}

function toRoman(value: number): string {
  const values: readonly [number, string][] = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ]
  let remaining = value
  let roman = ""
  for (const [amount, glyph] of values) {
    while (remaining >= amount) {
      roman += glyph
      remaining -= amount
    }
  }
  return roman
}

function ordinalSuffix(value: number): string {
  const lastTwo = value % 100
  if (lastTwo >= 11 && lastTwo <= 13) return "th"
  switch (value % 10) {
    case 1:
      return "st"
    case 2:
      return "nd"
    case 3:
      return "rd"
    default:
      return "th"
  }
}

function toEnglishOrdinal(value: number): string {
  const groups: string[] = []
  let remaining = value
  let scaleIndex = 0
  while (remaining > 0) {
    const group = remaining % 1000
    if (group > 0) {
      const cardinal = `${toCardinalGroup(group)}${SCALES[scaleIndex] ? ` ${SCALES[scaleIndex]}` : ""}`
      groups.unshift(cardinal)
    }
    remaining = Math.floor(remaining / 1000)
    scaleIndex++
  }
  const lastGroup = groups.length - 1
  groups[lastGroup] = ordinalizeLastWord(groups[lastGroup] ?? "")
  return groups.join(" ")
}

function toCardinalGroup(value: number): string {
  const parts: string[] = []
  if (value >= 100) {
    parts.push(SMALL_CARDINALS[Math.floor(value / 100)], "Hundred")
    value %= 100
  }
  if (value >= 20) {
    const tens = TENS[Math.floor(value / 10)]
    parts.push(value % 10 > 0 ? `${tens}-${SMALL_CARDINALS[value % 10]}` : tens)
  } else if (value > 0) {
    parts.push(SMALL_CARDINALS[value])
  }
  return parts.join(" ")
}

function ordinalizeLastWord(phrase: string): string {
  const lastSeparator = Math.max(phrase.lastIndexOf(" "), phrase.lastIndexOf("-"))
  const lastWord = phrase.slice(lastSeparator + 1)
  return `${phrase.slice(0, lastSeparator + 1)}${ORDINALS[lastWord] ?? `${lastWord}th`}`
}
