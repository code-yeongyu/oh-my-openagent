// Which body diff this device's captures use (PR #12295 review). The line diff (#12279) is safe only
// when no member of the account still runs the character diff: next to an old device's concurrent
// character inserts, a whole-line delete strands them on the next, unedited line. So the line diff
// runs only when the verified membership is known and every other member's LATEST verified batch
// advertised it; anything unknown is the character diff, the merge every build before #12279 produces.

import type { BodyDiff } from "../item"
import type { SyncJournal } from "./journal"
import type { Advertisement } from "./ports"

/** What this device last heard from one member: the seq of its newest verified batch and its advertisement. */
export interface Heard {
  readonly seq: number
  readonly bodyLine: boolean
}

export function bodyDiffFor(others: readonly string[] | null, heard: Readonly<Record<string, Heard>>): BodyDiff {
  if (others === null) return "char"
  return others.every((member) => heard[member]?.bodyLine === true) ? "line" : "char"
}

/** `heard` with `author`'s batch at `seq` recorded, unless a batch at or after `seq` already is. */
export function withHeard(
  heard: Readonly<Record<string, Heard>>,
  seq: number,
  advertisement: Advertisement,
): Readonly<Record<string, Heard>> {
  const known = heard[advertisement.author]
  if (known !== undefined && known.seq >= seq) return heard
  return { ...heard, [advertisement.author]: { seq, bodyLine: advertisement.bodyLine } }
}

/** Journals what the verified batch at `seq` says about its author's build. */
export async function hear(journal: SyncJournal, seq: number, advertisement: Advertisement): Promise<void> {
  const state = await journal.state()
  const heard = withHeard(state.heard, seq, advertisement)
  if (heard !== state.heard) await journal.updateState({ heard })
}
