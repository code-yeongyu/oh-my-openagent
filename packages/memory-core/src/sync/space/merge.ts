// Insert-only text merge (sync-design §3 adoption): the result is a common supersequence
// of the base and incoming text. Lines are indivisible: similar-looking prose is not
// evidence of shared edit history and must never be spliced character by character.
// Identical inputs return the base unchanged ("identical adoption adds nothing").
// Line alignment runs under a cell budget; beyond it, concatenate complete lines.
// Add a boundary after an unterminated line when more output follows. Both paths
// preserve every input line and remain common character supersequences.

export function isOrderedSubsequence(needle: string, haystack: string): boolean {
  const n = [...needle]
  let i = 0
  for (const ch of haystack) {
    if (i < n.length && ch === n[i]) i++
  }
  return i === n.length
}

const DEFAULT_MAX_CELLS = 16_000_000

export function mergeInsertions(base: string, incoming: string, maxCells = DEFAULT_MAX_CELLS): string {
  if (base === incoming) return base
  if (base === "") return incoming
  if (incoming === "") return base
  const la = splitLines(base)
  const lb = splitLines(incoming)
  const lines = (la.length + 1) * (lb.length + 1) <= maxCells
    ? supersequence(la, lb, lcs(la, lb))
    : [...la, ...lb]
  const trailingNewline = base.endsWith("\n") || incoming.endsWith("\n")
  return lines.join("\n") + (trailingNewline ? "\n" : "")
}

function splitLines(text: string): string[] {
  if (text === "") return []
  const lines = text.split("\n")
  if (text.endsWith("\n")) lines.pop()
  return lines
}

function supersequence(a: readonly string[], b: readonly string[], anchors: readonly string[]): string[] {
  const out: string[] = []
  let i = 0
  let j = 0
  for (const anchor of anchors) {
    while (i < a.length && a[i] !== anchor) out.push(a[i++] ?? "")
    while (j < b.length && b[j] !== anchor) out.push(b[j++] ?? "")
    out.push(anchor)
    i++
    j++
  }
  while (i < a.length) out.push(a[i++] ?? "")
  while (j < b.length) out.push(b[j++] ?? "")
  return out
}

function lcs(a: readonly string[], b: readonly string[]): string[] {
  const n = a.length
  const m = b.length
  const w = m + 1
  const dp = new Uint32Array((n + 1) * w)
  const at = (i: number, j: number) => dp[i * w + j] ?? 0
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    const x = a[i]
    if (x !== undefined && x === b[j]) {
      out.push(x)
      i++
      j++
    } else if (at(i + 1, j) >= at(i, j + 1)) i++
    else j++
  }
  return out
}
