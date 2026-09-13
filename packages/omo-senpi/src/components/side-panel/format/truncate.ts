/**
 * Width-safe text helpers. Rows carry theme colour, so every measurement counts
 * printable characters and never the escape sequences around them.
 */

const ANSI = /\x1b\[[0-9;]*m/g

/** Printable length, ignoring colour. */
export function visibleWidth(text: string): number {
  return text.replace(ANSI, "").length
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
    if (used === budget) break
    out += text[index]
    used += 1
  }
  return `${out}${width > 1 ? "…" : ""}${coloured ? "\x1b[39m" : ""}`
}

/** Cut to `width` keeping the tail, for paths whose identifying part sits at the end. */
export function truncateVisibleStart(text: string, width: number): string {
  if (width <= 0) return ""
  const visible = visibleWidth(text)
  if (visible <= width) return text
  const plain = text.replace(ANSI, "")
  if (width <= 1) return plain.slice(plain.length - width)
  return `…${plain.slice(plain.length - (width - 1))}`
}
