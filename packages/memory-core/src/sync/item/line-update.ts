// Body text writes are whole-line ops that cannot strand another device's concurrent insert (#12279,
// review of #12295). A character diff turns two concurrent replacements of one line into an interleave
// that matches neither edit. Loro's own line diff fixes that, but it inserts the new lines BEFORE the
// replaced ones and deletes them with their newline, so a concurrent character insert anchored inside
// the replaced line (any older build) ends up after the new lines with no newline of its own: glued
// onto the next, unedited line.
// Here each changed hunk inserts its new lines immediately AFTER the old hunk's last "\n" and then
// deletes the old hunk. Every concurrent insert anchored inside the old hunk orders before that "\n",
// so it can only attach to the start of this device's first new line, inside the edited region; the
// new lines carry their own newlines, so a concurrent delete of the old hunk cannot strand them either.
// Loro's line unit includes its "\n", so on an LF-less text a line op turns `last` -> `last\n` into a
// delete and re-insert of the line; such texts keep the character diff (section 5 of the design).

import type { LoroDoc } from "../../crdt/loro-runtime"

type LoroText = ReturnType<LoroDoc["getText"]>

interface Hunk {
  /** Old lines [from, to) are replaced by `lines`. */
  readonly from: number
  readonly to: number
  readonly lines: readonly string[]
}

/**
 * Edit-distance bound of the Myers line diff. The diff costs O((N + M) * D) time and O(D^2) memory, so a
 * few edits spread over a long note stay cheap and stay separate hunks (review of #12295: measuring the
 * span between the first and last changed line instead merged a top edit and a bottom append into one
 * 2,000-line block). Past this many inserted plus deleted lines the body keeps the character merge it had
 * before #12279, which never duplicates or revives a line.
 */
const MAX_EDITS = 2_000

export function updateBodyText(text: LoroText, target: string): void {
  const current = text.toString()
  if (current === target) return
  if (!lineTerminated(current) || !lineTerminated(target)) {
    text.update(target)
    return
  }
  const before = splitLines(current)
  const hunks = lineHunks(before, splitLines(target))
  if (hunks === null) {
    text.update(target)
    return
  }
  const offsets = [0]
  for (const line of before) offsets.push((offsets.at(-1) ?? 0) + line.length)
  // Last hunk first, so the offsets of the earlier ones stay valid.
  for (const hunk of hunks.reverse()) {
    const start = offsets[hunk.from] ?? 0
    const end = offsets[hunk.to] ?? 0
    if (hunk.lines.length > 0) text.insert(end, hunk.lines.join(""))
    if (end > start) text.delete(start, end - start)
  }
}

function lineTerminated(value: string): boolean {
  return value === "" || value.endsWith("\n")
}

/** Lines with their own "\n"; the caller guarantees the text is empty or ends in "\n". */
function splitLines(value: string): string[] {
  return value === ""
    ? []
    : value
        .slice(0, -1)
        .split("\n")
        .map((line) => `${line}\n`)
}

/** The changed hunks of `a` -> `b`, or null when more than MAX_EDITS lines change. */
function lineHunks(a: readonly string[], b: readonly string[]): Hunk[] | null {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const n = a.length - head - tail
  const m = b.length - head - tail
  if (n === 0 && m === 0) return []
  const script = myersScript(a.slice(head, head + n), b.slice(head, head + m))
  if (script === null) return null
  const hunks: Hunk[] = []
  let open: { from: number; to: number; lines: string[] } | null = null
  let x = 0
  let y = 0
  for (const step of script) {
    if (step === "keep") {
      if (open !== null) hunks.push(open)
      open = null
      x++
      y++
      continue
    }
    open ??= { from: head + x, to: head + x, lines: [] }
    if (step === "insert") {
      open.lines.push(b[head + y] ?? "")
      y++
    } else {
      x++
      open.to = head + x
    }
  }
  if (open !== null) hunks.push(open)
  return hunks
}

type Step = "keep" | "insert" | "delete"

/**
 * Myers' greedy shortest edit script ("An O(ND) Difference Algorithm", 1986), forward pass with the V
 * array of every round kept for the backtrack; null when the shortest script needs more than MAX_EDITS
 * inserts plus deletes. Within a round a delete is preferred when both moves reach the same diagonal, so a
 * replaced line becomes delete-then-insert, the order the hunk builder expects.
 */
function myersScript(a: readonly string[], b: readonly string[]): Step[] | null {
  const n = a.length
  const m = b.length
  const limit = Math.min(n + m, MAX_EDITS)
  const offset = limit + 1
  const trace: Int32Array[] = []
  let v = new Int32Array(2 * limit + 3)
  for (let d = 0; d <= limit; d++) {
    const next = v.slice()
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      next[offset + k] = x
      if (x >= n && y >= m) {
        trace.push(next)
        return backtrack(trace, offset, n, m)
      }
    }
    trace.push(next)
    v = next
  }
  return null
}

function backtrack(trace: readonly Int32Array[], offset: number, n: number, m: number): Step[] {
  const steps: Step[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d - 1] ?? new Int32Array(0)
    const k = x - y
    const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))
    const prevK = down ? k + 1 : k - 1
    const prevX = v[offset + prevK] ?? 0
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      steps.push("keep")
      x--
      y--
    }
    steps.push(down ? "insert" : "delete")
    x = prevX
    y = prevY
  }
  while (x > 0 && y > 0) {
    steps.push("keep")
    x--
    y--
  }
  return steps.reverse()
}
