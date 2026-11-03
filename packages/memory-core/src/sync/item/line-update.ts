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
 * Above this many LCS cells the changed middle is one coarse hunk: exact for this device, and still no
 * fragment leaves the middle, but inside it a concurrent edit of a line this device did not change can be
 * displaced, or the original line duplicated (design 11.6).
 */
const MAX_CELLS = 4_000_000

export function updateBodyText(text: LoroText, target: string): void {
  const current = text.toString()
  if (current === target) return
  if (!lineTerminated(current) || !lineTerminated(target)) {
    text.update(target)
    return
  }
  const before = splitLines(current)
  const offsets = [0]
  for (const line of before) offsets.push((offsets.at(-1) ?? 0) + line.length)
  // Last hunk first, so the offsets of the earlier ones stay valid.
  for (const hunk of lineHunks(before, splitLines(target)).reverse()) {
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

function lineHunks(a: readonly string[], b: readonly string[]): Hunk[] {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const rows = a.length - head - tail
  const cols = b.length - head - tail
  if (rows === 0 && cols === 0) return []
  if ((rows + 1) * (cols + 1) > MAX_CELLS) return [{ from: head, to: head + rows, lines: b.slice(head, head + cols) }]
  // common[x * (cols + 1) + y]: LCS length of a[head + x ..] and b[head + y ..] within the middle.
  const width = cols + 1
  const common = new Uint32Array((rows + 1) * width)
  for (let x = rows - 1; x >= 0; x--) {
    for (let y = cols - 1; y >= 0; y--) {
      common[x * width + y] =
        a[head + x] === b[head + y]
          ? (common[(x + 1) * width + y + 1] ?? 0) + 1
          : Math.max(common[(x + 1) * width + y] ?? 0, common[x * width + y + 1] ?? 0)
    }
  }
  const hunks: Hunk[] = []
  let open: { from: number; to: number; lines: string[] } | null = null
  let x = 0
  let y = 0
  while (x < rows || y < cols) {
    if (x < rows && y < cols && a[head + x] === b[head + y]) {
      if (open !== null) hunks.push(open)
      open = null
      x++
      y++
      continue
    }
    open ??= { from: head + x, to: head + x, lines: [] }
    const insert = y < cols && (x >= rows || (common[x * width + y + 1] ?? 0) >= (common[(x + 1) * width + y] ?? 0))
    if (insert) {
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
