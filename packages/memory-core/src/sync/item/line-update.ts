// Body text diffs are line-granular (#12279). A character diff turns two concurrent replacements of
// one line into a character interleave that matches neither edit; with whole-line ops both
// replacements survive as whole adjacent lines, the body's form of the multi-value register
// (state.ts) and of adoption's indivisible lines (space/merge.ts).
// Loro's line unit includes its "\n", so on an LF-less text a line diff turns `last` -> `last\n`
// into a delete and re-insert of the line, and a concurrent edit of that line resurrects it.
// Such texts keep the character diff until a separator-aware line diff exists.

import type { LoroDoc } from "../../crdt/loro-runtime"

type LoroText = ReturnType<LoroDoc["getText"]>

export function updateTextByLine(text: LoroText, target: string): void {
  if (lineTerminated(text.toString()) && lineTerminated(target)) text.updateByLine(target)
  else text.update(target)
}

function lineTerminated(value: string): boolean {
  return value === "" || value.endsWith("\n")
}
