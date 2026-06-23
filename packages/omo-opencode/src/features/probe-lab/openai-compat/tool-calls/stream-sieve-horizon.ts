import { stripFencedCode } from "./parser/fenced-code"

const OPENER_LITERALS: ReadonlyArray<string> = [
  "<|DSML|tool_calls|>",
  "<<|DSML|tool_calls>",
  "<|DSML|tool_calls>",
  "<DSML|tool_calls>",
  "<|DSML tool_calls>",
  "<|DSMLtool_calls>",
  "<DSMLtool_calls>",
  "<tool_calls>",
]

const FENCE_MARKERS: ReadonlyArray<string> = ["```", "~~~"]

function findEarliestOpenFenceIdx(buffer: string): number {
  let earliest = -1
  for (const marker of FENCE_MARKERS) {
    let pos = 0
    while (pos < buffer.length) {
      let openIdx: number
      if (pos === 0 && buffer.startsWith(marker)) {
        openIdx = 0
      } else {
        const found = buffer.indexOf(`\n${marker}`, pos)
        if (found === -1) break
        openIdx = found + 1
      }
      const afterOpen = openIdx + marker.length
      const closeFound = buffer.indexOf(`\n${marker}`, afterOpen)
      if (closeFound === -1) {
        if (earliest === -1 || openIdx < earliest) earliest = openIdx
        break
      }
      pos = closeFound + 1 + marker.length
    }
  }
  return earliest
}

function findEarliestOpenDsmlOpenerIdx(buffer: string): number {
  if (buffer.length === 0) return -1
  const { clean } = stripFencedCode(buffer)
  let earliest = -1
  for (const opener of OPENER_LITERALS) {
    const idx = clean.indexOf(opener)
    if (idx >= 0 && (earliest === -1 || idx < earliest)) earliest = idx
  }
  return earliest
}

function findTailPartialIdx(buffer: string): number {
  if (buffer.length === 0) return -1
  let earliest = -1
  for (const opener of OPENER_LITERALS) {
    const maxLen = Math.min(opener.length - 1, buffer.length)
    for (let len = maxLen; len >= 1; len--) {
      const tail = buffer.slice(buffer.length - len)
      if (opener.startsWith(tail)) {
        const idx = buffer.length - len
        if (earliest === -1 || idx < earliest) earliest = idx
        break
      }
    }
  }
  for (const marker of FENCE_MARKERS) {
    const maxLen = Math.min(marker.length - 1, buffer.length)
    for (let len = maxLen; len >= 1; len--) {
      const tail = buffer.slice(buffer.length - len)
      if (marker.startsWith(tail)) {
        const tailStart = buffer.length - len
        if (tailStart === 0 || buffer[tailStart - 1] === "\n") {
          if (earliest === -1 || tailStart < earliest) earliest = tailStart
        }
        break
      }
    }
  }
  return earliest
}

export function computeHorizon(buffer: string): number {
  if (buffer.length === 0) return 0
  let h = buffer.length
  const fence = findEarliestOpenFenceIdx(buffer)
  if (fence >= 0 && fence < h) h = fence
  const opener = findEarliestOpenDsmlOpenerIdx(buffer)
  if (opener >= 0 && opener < h) h = opener
  const tail = findTailPartialIdx(buffer)
  if (tail >= 0 && tail < h) h = tail
  return h
}

export function isResidualPartialDsml(buffer: string): boolean {
  if (buffer.length === 0) return false
  for (const opener of OPENER_LITERALS) {
    if (buffer.startsWith(opener)) return true
    const maxLen = Math.min(opener.length - 1, buffer.length)
    for (let len = maxLen; len >= 1; len--) {
      const head = buffer.slice(0, len)
      if (opener.startsWith(head) && head === buffer) return true
    }
  }
  return false
}
