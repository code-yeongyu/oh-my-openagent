/**
 * The one Markdown reading the changelog release uses (#10477 review rounds 2-3): which lines sit inside a code
 * fence, and where an entry's PR link goes. Fences follow CommonMark: a fence opens with three or more ` or ~,
 * and only a line of the same character, at least as long, with nothing after it, closes it. An unclosed fence is
 * an error, so the PR check refuses it before the fragment becomes immutable.
 */

const OPEN = /^ {0,3}(`{3,}|~{3,})/

export type ScannedLine = { readonly text: string; readonly fenced: boolean }

/** Every line with whether it belongs to a fenced block (the fence lines themselves included). */
export function scanFences(text: string): ScannedLine[] {
  const lines: ScannedLine[] = []
  let open: string | null = null
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const stripped = line.replace(/^\s*/, "")
    if (open === null) {
      const marker = OPEN.exec(stripped)?.[1]
      if (marker !== undefined && !(marker[0] === "`" && stripped.slice(marker.length).includes("`"))) open = marker
      lines.push({ text: line, fenced: marker !== undefined && open !== null })
    } else {
      lines.push({ text: line, fenced: true })
      const close = new RegExp(`^\\${open[0]}{${open.length},}\\s*$`)
      if (close.test(stripped)) open = null
    }
  }
  if (open !== null) throw new Error(`a code fence (${open}) is never closed`)
  return lines
}

/** Blank-line-separated blocks; a blank line inside a fence does not end a block. */
export function blocksOf(text: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  for (const line of scanFences(text)) {
    if (!line.fenced && line.text.trim() === "") {
      if (current.length > 0) blocks.push(current.join("\n"))
      current = []
    } else {
      current.push(line.text)
    }
  }
  if (current.length > 0) blocks.push(current.join("\n"))
  return blocks
}

/**
 * The entry with a link to `pr` unless it already links this repository's PR `pr` (duty ruling, #10477 r3). Links to
 * other PRs, in this repository or any other, never count, so an upstream citation keeps our credit and a folded
 * car's entry names both the car and the batch. The link goes at the end of the entry's last line outside any fence,
 * so code is never touched; an entry that is all code stays as written.
 */
export function linkEntry(entry: string, pr: number, pullUrl: string): string {
  if (entry.includes(`${pullUrl}/${pr})`)) return entry
  const lines = scanFences(entry)
  const last = lines.findLastIndex((line) => !line.fenced && line.text.trim() !== "")
  if (last === -1) return entry
  return lines.map((line, index) => (index === last ? `${line.text.trimEnd()} ([#${pr}](${pullUrl}/${pr}))` : line.text)).join("\n")
}
