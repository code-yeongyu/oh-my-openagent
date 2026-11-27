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

/** The four accepted spellings of a persisted numbered nickname, including its visible base. */
export function nicknameOccurrenceAliases(label: string): readonly string[] {
  const point = splitOccurrence(label)
  if (point === undefined) return []
  const { base, occurrence } = point
  const styles: readonly OccurrenceStyle[] = ["#", "roman", "full", "arabic"]
  return styles.map((style) => `${base}${occurrenceSuffix(occurrence, style)}`)
}

function splitOccurrence(label: string): { base: string; occurrence: number } | undefined {
  const numeric = /^(.*) (?:#([1-9]\d*)|the ([1-9]\d*)(st|nd|rd|th))$/i.exec(label)
  const written = /^(.*) the ([a-z -]+)$/i.exec(label)
  const roman = /^(.*) ([ivxlcdm]+)$/i.exec(label)
  let base: string
  let occurrence: number
  if (numeric !== null) {
    base = numeric[1]
    occurrence = Number(numeric[2] ?? numeric[3])
    if (numeric[4] !== undefined && numeric[4].toLowerCase() !== ordinalSuffix(occurrence)) return undefined
  } else if (written !== null) {
    base = written[1]
    const suffix = written[2].toLowerCase()
    occurrence = readEnglishOrdinal(suffix)
    if (!Number.isSafeInteger(occurrence) || occurrence < 2 || toEnglishOrdinal(occurrence).toLowerCase() !== suffix)
      return undefined
  } else if (roman !== null) {
    base = roman[1]
    const suffix = roman[2].toUpperCase()
    const amounts: Readonly<Record<string, number>> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
    occurrence = [...suffix].reduce(
      (total, glyph, index) => total + amounts[glyph] * (amounts[glyph] < amounts[suffix[index + 1]] ? -1 : 1),
      0,
    )
    if (occurrence > 3999 || toRoman(occurrence) !== suffix) return undefined
  } else {
    return undefined
  }
  return Number.isSafeInteger(occurrence) && occurrence >= 2 ? { base, occurrence } : undefined
}

function readEnglishOrdinal(suffix: string): number {
  const words = suffix.split(/[ -]/)
  const ending = words.pop() ?? ""
  const cardinal = Object.entries(ORDINALS).find(([, word]) => word.toLowerCase() === ending)?.[0]
  words.push(cardinal?.toLowerCase() ?? ending.replace(/th$/, ""))
  let total = 0
  let group = 0
  for (const word of words) {
    const small = SMALL_CARDINALS.findIndex((item) => item.toLowerCase() === word)
    const tens = TENS.findIndex((item) => item.toLowerCase() === word)
    const scale = SCALES.findIndex((item) => item.toLowerCase() === word)
    if (small > 0) group += small
    else if (tens > 0) group += tens * 10
    else if (word === "hundred") group *= 100
    else if (scale > 0) {
      total += group * 1000 ** scale
      group = 0
    } else return Number.NaN
  }
  return total + group
}
