/**
 * The one Markdown reading the changelog release uses (#10477 review rounds 2-3): which lines sit inside a code
 * fence, and where an entry's PR link goes. Fences follow CommonMark: a fence opens with three or more ` or ~,
 * and only a line of the same character, at least as long, with nothing after it, closes it. An unclosed fence is
 * an error, so the PR check refuses it before the fragment becomes immutable. A fence may be indented at most three
 * spaces past the text column of the list item it sits in (column 0 outside a list); deeper is an indented code line.
 * List items follow CommonMark too: a `-`, `*` or `+` bullet or a `1.` / `1)` number, whose text column is the
 * marker's column plus its width plus the spaces after it (one when there are more than four or none).
 */

const OPEN = /^(`{3,}|~{3,})/
const LIST_MARKER = /^([-*+]|\d{1,9}[.)])([ \t]+|$)/

/** `indentedCode`: an indented code block line (4+ columns past its container, after a blank line); never linked. */
export type ScannedLine = { readonly text: string; readonly fenced: boolean; readonly indentedCode: boolean }

/** The column after `whitespace` written from column `from`: a space moves one column, a tab to the next multiple of 4. */
const columnsAfter = (from: number, whitespace: string): number => [...whitespace].reduce((column, char) => (char === "\t" ? column + 4 - (column % 4) : column + 1), from)

/** Leading whitespace width, a tab moving to the next multiple of four columns. */
const indentOf = (line: string): number => columnsAfter(0, /^[ \t]*/.exec(line)?.[0] ?? "")

/** Every line with whether it belongs to a fenced block (the fence lines themselves included). */
export function scanFences(text: string): ScannedLine[] {
  const lines: ScannedLine[] = []
  let open: { readonly marker: string; readonly base: number } | null = null
  // Text columns of the list items the current line can belong to, innermost last.
  const items: number[] = []
  // Whether the previous line was blank or indented code: only then can a line start or continue an indented code block.
  let codeMayStart: boolean = true
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const stripped = line.replace(/^\s*/, "")
    const indent = indentOf(line)
    if (open === null) {
      if (stripped !== "") while ((items.at(-1) ?? 0) > indent) items.pop()
      const item = items.at(-1) ?? 0
      const listMarker = indent - item <= 3 ? LIST_MARKER.exec(stripped) : null
      if (listMarker !== null) {
        const start = indent + (listMarker[1]?.length ?? 0)
        const gap = columnsAfter(start, listMarker[2] ?? "") - start
        items.push(start + (gap >= 1 && gap <= 4 ? gap : 1))
      }
      const candidate = listMarker === null && indent - item <= 3 ? OPEN.exec(stripped)?.[1] : undefined
      const marker = candidate !== undefined && !(candidate[0] === "`" && stripped.slice(candidate.length).includes("`")) ? candidate : undefined
      if (marker !== undefined) open = { marker, base: item }
      const indentedCode: boolean = marker === undefined && listMarker === null && stripped !== "" && codeMayStart && indent - item >= 4
      lines.push({ text: line, fenced: marker !== undefined, indentedCode })
      codeMayStart = stripped === "" || indentedCode
    } else {
      lines.push({ text: line, fenced: true, indentedCode: false })
      const close = new RegExp(`^\\${open.marker[0]}{${open.marker.length},}\\s*$`)
      const closes = indent - open.base <= 3 && close.test(stripped)
      if (closes) open = null
      // A closed fence is not a paragraph, so a 4-space line right after it starts indented code (CommonMark).
      codeMayStart = closes
    }
  }
  if (open !== null) throw new Error(`a code fence (${open.marker}) is never closed`)
  return lines
}

const isBlank = (line: ScannedLine): boolean => !line.fenced && line.text.trim() === ""
const isColumn0ListItem = (line: ScannedLine): boolean => !line.fenced && indentOf(line.text) === 0 && LIST_MARKER.test(line.text)

/**
 * The paragraph entries of `text`, read from ONE scan of the whole text so a fence keeps its list context (#11253 review
 * round 3). A blank line ends an entry only when the next line starts a new one at column 0: a paragraph, or a list item
 * when the entry itself is a list item. A list that continues an intro paragraph, and the fences inside its items, stay in
 * that paragraph's entry. Leading and trailing blank lines are dropped.
 */
export function entriesOf(text: string): ScannedLine[][] {
  const entries: ScannedLine[][] = []
  let current: ScannedLine[] = []
  let blanks: ScannedLine[] = []
  for (const line of scanFences(text)) {
    if (isBlank(line)) {
      if (current.length > 0) blanks.push(line)
      continue
    }
    const startsColumn0 = !line.fenced && indentOf(line.text) === 0
    const continuesIntroList = isColumn0ListItem(line) && current.length > 0 && !isColumn0ListItem(current[0] ?? line)
    if (current.length > 0 && blanks.length > 0 && startsColumn0 && !continuesIntroList) {
      entries.push(current)
      current = []
    } else current.push(...blanks)
    blanks = []
    current.push(line)
  }
  if (current.length > 0) entries.push(current)
  return entries
}

/** Already-scanned entry lines with the link added, by the rule linkEntry documents. */
export function linkScanned(lines: readonly ScannedLine[], pr: number, pullUrl: string): string {
  const prose = (line: ScannedLine): boolean => !line.fenced && !line.indentedCode
  if (lines.some((line) => prose(line) && line.text.includes(`${pullUrl}/${pr})`))) return lines.map((line) => line.text).join("\n")
  const last = lines.findLastIndex((line) => prose(line) && line.text.trim() !== "")
  return lines.map((line, index) => (index === last ? `${line.text.trimEnd()} ([#${pr}](${pullUrl}/${pr}))` : line.text)).join("\n")
}

/**
 * The entry with a link to `pr` unless it already links this repository's PR `pr` (duty ruling, #10477 r3). Links to
 * other PRs, in this repository or any other, never count, so an upstream citation keeps our credit and a folded
 * car's entry names both the car and the batch. The link goes at the end of the entry's last line outside any fence,
 * so code is never touched; an entry that is all code stays as written.
 */
export function linkEntry(entry: string, pr: number, pullUrl: string): string {
  return linkScanned(scanFences(entry), pr, pullUrl)
}
