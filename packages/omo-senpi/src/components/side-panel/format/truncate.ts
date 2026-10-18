/**
 * Width-safe text helpers. Rows carry theme colour, so every measurement counts
 * printable characters and never the escape sequences around them.
 */

const ANSI = /\x1b\[[0-9;]*m/g
const ZERO_WIDTH = /[\p{Mark}\u200d\ufe0e\ufe0f]/u

/** Terminal cell width, ignoring colour. */
export function visibleWidth(text: string): number {
  let width = 0
  for (const character of text.replace(ANSI, "")) width += characterWidth(character)
  return width
}

/** Pad on the right to `width` printable characters; longer text is returned untouched. */
export function padVisible(text: string, width: number): string {
  const visible = visibleWidth(text)
  if (visible >= width) return text
  return text + " ".repeat(width - visible)
}

/**
 * Cut to `width` printable characters, keeping the head and marking the cut.
 * Colour runs are preserved: escapes pass through without consuming width, and a
 * reset is appended when the text was cut mid-colour.
 */
export function truncateVisible(text: string, width: number): string {
  if (width <= 0) return ""
  if (visibleWidth(text) <= width) return text
  const budget = width > 1 ? width - 1 : width
  let out = ""
  let used = 0
  let coloured = false
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\x1b") {
      const match = /^\x1b\[[0-9;]*m/.exec(text.slice(index))
      if (match !== null) {
        out += match[0]
        coloured = match[0] !== "\x1b[39m" && match[0] !== "\x1b[0m"
        index += match[0].length - 1
        continue
      }
    }
    const codePoint = text.codePointAt(index)
    if (codePoint === undefined) break
    const character = String.fromCodePoint(codePoint)
    const cells = characterWidth(character)
    if (used + cells > budget) break
    out += character
    used += cells
    index += character.length - 1
  }
  return `${out}${width > 1 ? "…" : ""}${coloured ? "\x1b[39m" : ""}`
}

/** Cut to `width` keeping the tail, for paths whose identifying part sits at the end. */
export function truncateVisibleStart(text: string, width: number): string {
  if (width <= 0) return ""
  const visible = visibleWidth(text)
  if (visible <= width) return text
  const plain = text.replace(ANSI, "")
  if (width <= 1) return takeTail(plain, width)
  return `…${takeTail(plain, width - 1)}`
}

/**
 * Break text into rows no wider than `width` printable characters, for a viewer that paints one
 * row per line. Existing newlines are kept, words are not broken unless a single word is wider
 * than the column, and colour is out of scope here: this runs on raw text before painting.
 */
export function wrapVisible(text: string, width: number): string[] {
  if (!Number.isFinite(width) || width <= 0) return []
  const rows: string[] = []
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      rows.push("")
      continue
    }
    let row = ""
    for (const token of paragraph.match(/\s+|\S+/gu) ?? []) {
      let pending = token
      while (pending !== "") {
        const room = width - visibleWidth(row)
        if (visibleWidth(pending) <= room) {
          row += pending
          pending = ""
          continue
        }
        if (row !== "") {
          if (pending === " ") {
            rows.push(row)
            row = ""
            pending = ""
            continue
          }
          if (!/^\s/u.test(pending) && row.endsWith(" ") && !row.endsWith("  ")) row = row.slice(0, -1)
          rows.push(row)
          row = ""
          continue
        }
        const [head, tail] = splitAtWidth(pending, width)
        rows.push(head)
        pending = tail
      }
    }
    if (row !== "") rows.push(row)
  }
  return rows
}

function characterWidth(character: string): number {
  if (ZERO_WIDTH.test(character)) return 0
  const codePoint = character.codePointAt(0)
  if (codePoint === undefined || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0
  return isWide(codePoint) ? 2 : 1
}

function splitAtWidth(text: string, width: number): readonly [string, string] {
  let head = ""
  let used = 0
  for (const character of text) {
    const cells = characterWidth(character)
    if (used + cells > width) break
    head += character
    used += cells
  }
  return [head, text.slice(head.length)]
}

function takeTail(text: string, width: number): string {
  const characters = [...text]
  let tail = ""
  let used = 0
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const character = characters[index]
    if (character === undefined) continue
    const cells = characterWidth(character)
    if (used + cells > width) break
    tail = character + tail
    used += cells
  }
  return tail
}

function isWide(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  )
}
