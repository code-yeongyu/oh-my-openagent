/**
 * Terminal safety for everything the panel paints.
 *
 * Row text carries strings the panel does not author: tool arguments, git paths (a valid file
 * name may hold a newline, BEL or ESC), task summaries, the goal objective, transcript and diff
 * lines. Written raw, an ESC can start a sequence the terminal executes, a BEL or ST can close the
 * row's own OSC 8 link early, and a newline breaks the column's one-row-per-line layout. Row text
 * never carries colour of its own - the theme paints `row.color` after this runs - so every C0 and
 * C1 control is removed, ESC included, and a file name cannot recolour the column either. Line
 * breaks and tabs become a space, so words on either side of them do not run together.
 */

const SPACING = new Set(["\t", "\n", "\v", "\f", "\r", "\u0085"])

export function sanitizeTerminalText(text: string): string {
  let out = ""
  for (const char of text) {
    const code = char.charCodeAt(0)
    if (isControl(code)) {
      if (SPACING.has(char)) out += " "
      continue
    }
    out += char
  }
  return out
}

function isControl(code: number): boolean {
  return code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)
}
