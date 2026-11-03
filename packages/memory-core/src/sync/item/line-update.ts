// Body text diffs (#12279, PR #12295 review). "line": whole-line ops, so two concurrent replacements of
// one line survive as whole adjacent lines, the body's form of the multi-value register (state.ts) and
// of adoption's indivisible lines (space/merge.ts). "char": the character diff of every build before
// #12279. Next to an old device's concurrent character inserts, a whole-line delete strands them on the
// next, unedited line, so the engine selects "line" only when every account member advertises it
// (engine/body-diff.ts), and every item-layer default is "char".
// Loro's line unit includes its "\n", so on an LF-less text a line diff turns `last` -> `last\n` into a
// delete and re-insert of the line, and a concurrent edit of that line resurrects it. Such texts keep
// the character diff until a separator-aware line diff exists.

import type { LoroDoc } from "../../crdt/loro-runtime"

type LoroText = ReturnType<LoroDoc["getText"]>

export type BodyDiff = "line" | "char"

export function updateBodyText(text: LoroText, target: string, bodyDiff: BodyDiff): void {
  if (bodyDiff === "line" && lineTerminated(text.toString()) && lineTerminated(target)) text.updateByLine(target)
  else text.update(target)
}

function lineTerminated(value: string): boolean {
  return value === "" || value.endsWith("\n")
}
