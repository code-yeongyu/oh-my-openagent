const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, index) => from + index)

const UNSAFE_CODE_UNITS: readonly number[] = [
  ...range(0x00, 0x1f),
  0x7f,
  ...range(0x80, 0x9f),
  0x061c,
  0x200e,
  0x200f,
  ...range(0x202a, 0x202e),
  ...range(0x2066, 0x2069),
  ...range(0x200b, 0x200d),
  ...range(0x2060, 0x2064),
  0xfeff,
  0x2028,
  0x2029,
  ...range(0xfff9, 0xfffb),
  0xd800,
  0xdc00,
]

const SEQUENCES: readonly string[] = [
  "\u001b]52;c;aGk=\u0007",
  "\u001b[2J\u001b[H",
  "\u001b[31mred\u001b[0m",
  "\u009b2J",
  "\u009d52;c;aGk=\u0007",
  "\u001b]0;x\u0007visible\u009b31m",
]

export const DISPLAY_UNSAFE: readonly string[] = [
  ...UNSAFE_CODE_UNITS.map((unit) => `a${String.fromCharCode(unit)}b`),
  ...SEQUENCES.map((sequence) => `a${sequence}b`),
]

export const ORDINARY: readonly string[] = ["세션 이름", "e\u0301", "\u{1F600}", "naïve café"]

const isHigh = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff
const isLow = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff

function listedUnsafe(unit: number, keepLineFeeds: boolean): boolean {
  if (unit <= 0x1f) return !(keepLineFeeds && unit === 0x0a)
  return (
    unit === 0x7f ||
    (unit >= 0x80 && unit <= 0x9f) ||
    unit === 0x061c ||
    (unit >= 0x200b && unit <= 0x200f) ||
    (unit >= 0x202a && unit <= 0x202e) ||
    (unit >= 0x2060 && unit <= 0x2064) ||
    (unit >= 0x2066 && unit <= 0x2069) ||
    unit === 0xfeff ||
    unit === 0x2028 ||
    unit === 0x2029 ||
    (unit >= 0xfff9 && unit <= 0xfffb)
  )
}

/** Offsets and values of the UTF-16 code units in `line` that a rendered line must not carry raw. */
export function unsafeCodeUnits(
  line: string,
  { keepLineFeeds = false }: { readonly keepLineFeeds?: boolean } = {},
): { readonly index: number; readonly unit: number }[] {
  const found: { index: number; unit: number }[] = []
  for (let index = 0; index < line.length; index++) {
    const unit = line.charCodeAt(index)
    if (isHigh(unit)) {
      if (isLow(line.charCodeAt(index + 1))) index++
      else found.push({ index, unit })
      continue
    }
    if (isLow(unit) || listedUnsafe(unit, keepLineFeeds)) found.push({ index, unit })
  }
  return found
}
