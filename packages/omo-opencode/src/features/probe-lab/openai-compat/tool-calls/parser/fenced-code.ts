export type FencedCodeStripResult = {
  clean: string
  fencedRanges: Array<[number, number]>
}

const FENCE_RE = /(^|\n)(```|~~~)([^\n]*)\n([\s\S]*?)(?:\n(\2))(?=\n|$)/g

export function stripFencedCode(text: string): FencedCodeStripResult {
  if (typeof text !== "string" || text.length === 0) {
    return { clean: text, fencedRanges: [] }
  }
  const ranges: Array<[number, number]> = []
  let out = ""
  let lastIndex = 0
  FENCE_RE.lastIndex = 0
  for (;;) {
    const m = FENCE_RE.exec(text)
    if (!m) break
    const matchStart = m.index + m[1]!.length
    const matchEnd = m.index + m[0].length
    out += text.slice(lastIndex, matchStart)
    out += " ".repeat(matchEnd - matchStart)
    ranges.push([matchStart, matchEnd])
    lastIndex = matchEnd
  }
  out += text.slice(lastIndex)
  return { clean: out, fencedRanges: ranges }
}
