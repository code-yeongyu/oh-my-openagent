// An independent port of libuv's quote_cmd_arg (src/win/process.c at oven-sh/libuv 8023581113b2, the libuv Bun 1.4.4
// pins), written against UTF-16 code units the way the C walks its WCHAR buffer, so the product is compared with
// libuv's algorithm rather than with itself. `_wcsrev` reverses WCHARs, which are code units, not code points.
const BACKSLASH = 0x5c
const QUOTE = 0x22
const SPACE = 0x20
const TAB = 0x09

export function libuvQuoteCmdArg(source: string): string {
  const units = Array.from({ length: source.length }, (_, index) => source.charCodeAt(index))
  if (units.length === 0) return '""'
  if (!units.some((unit) => unit === SPACE || unit === TAB || unit === QUOTE)) return source
  if (!units.some((unit) => unit === QUOTE || unit === BACKSLASH)) return `"${source}"`
  const target: number[] = []
  let quoteHit = true
  for (let index = units.length; index > 0; index -= 1) {
    const unit = units[index - 1] ?? 0
    target.push(unit)
    if (quoteHit && unit === BACKSLASH) {
      target.push(BACKSLASH)
    } else if (unit === QUOTE) {
      quoteHit = true
      target.push(BACKSLASH)
    } else {
      quoteHit = false
    }
  }
  target.reverse()
  return `"${String.fromCharCode(...target)}"`
}
