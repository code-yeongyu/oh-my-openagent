import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { HELD_ANSWERS } from "./held-answers"

// The held-answers list is closed and only shrinks (design lane ruling on T1a): the sites it held when T1a added it, each
// with the parity rows whose clearing releases it. An entry may leave only in the commit that clears its rows.
const CEILING = {
  "remote-verbs-ended-row": ["threads.setModel", "threads.interrupt", "threads.close"],
  "handoff-exact-ambiguity": ["threads.handoff"],
  "remote-resolve-self": [],
  "remote-resolve-slash": [],
} as const satisfies Readonly<Record<string, readonly string[]>>

const UNRESOLVED_PATH = join(import.meta.dir, "../../../../../../script/sdk-parity/unresolved.json")

function listProblems(
  held: Readonly<Record<string, { readonly rows: readonly string[] }>>,
  unresolved: ReadonlySet<string>,
): string[] {
  const ceiling: Readonly<Record<string, readonly string[]>> = CEILING
  return [
    ...Object.keys(held)
      .filter((site) => !(site in ceiling))
      .map((site) => `${site}: not in the list T1a closed; a held answer is never added`),
    ...Object.entries(ceiling)
      .filter(([site, rows]) => !(site in held) && rows.some((row) => unresolved.has(row)))
      .map(([site]) => `${site}: left the list while its rows are still unresolved`),
    ...Object.entries(held)
      .filter(([, entry]) => entry.rows.length > 0 && entry.rows.every((row) => !unresolved.has(row)))
      .map(([site]) => `${site}: its rows are cleared; the entry no longer applies`),
  ].toSorted()
}

const unresolvedRows = (): ReadonlySet<string> =>
  new Set(
    (JSON.parse(readFileSync(UNRESOLVED_PATH, "utf8")) as { entries: readonly { readonly id: string }[] }).entries.map(
      (entry) => entry.id,
    ),
  )

describe("the held-answers list (design lane ruling on T1a)", () => {
  test("#given the list and the unresolved record #when compared #then no entry was added, none left early and none outlived its rows", () => {
    expect(listProblems(HELD_ANSWERS, unresolvedRows())).toEqual([])
  })

  test("#given a list that grew, one that shrank early and one that outlived its rows #when compared #then each is named", () => {
    const unresolved = new Set(["threads.setModel", "threads.interrupt", "threads.close"])
    const { "remote-verbs-ended-row": _verbs, ...withoutVerbs } = HELD_ANSWERS
    expect(listProblems({ ...HELD_ANSWERS, "new-site": { rows: [] } }, unresolved)).toEqual([
      "handoff-exact-ambiguity: its rows are cleared; the entry no longer applies",
      "new-site: not in the list T1a closed; a held answer is never added",
    ])
    expect(listProblems(withoutVerbs, unresolved)).toEqual([
      "handoff-exact-ambiguity: its rows are cleared; the entry no longer applies",
      "remote-verbs-ended-row: left the list while its rows are still unresolved",
    ])
  })
})
