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

const REPO_ROOT = join(import.meta.dir, "../../../../../..")

/** An entry whose rows are empty is retired by its slice's removal of `retiredWith`: listed without that export, it fails. */
function retirementProblems(
  held: Readonly<Record<string, object>>,
  exists: (file: string, symbol: string) => boolean,
): string[] {
  return Object.entries(held).flatMap(([site, entry]) => {
    const rows = Reflect.get(entry, "rows") as readonly string[]
    const retired = Reflect.get(entry, "retiredWith") as { readonly file: string; readonly symbol: string } | undefined
    if (rows.length > 0) return []
    if (retired === undefined) return [`${site}: names no row and no retiredWith export, so nothing retires it`]
    return exists(retired.file, retired.symbol)
      ? []
      : [`${site}: ${retired.symbol} left ${retired.file}; its slice removes this entry in the same commit`]
  })
}

const exportedIn = (file: string, symbol: string): boolean =>
  new RegExp(`^export (?:async )?(?:function|const) ${symbol}\\b`, "m").test(
    readFileSync(join(REPO_ROOT, file), "utf8"),
  )

describe("the held-answers list (design lane ruling on T1a)", () => {
  test("#given the entries no parity row names #when their retiring export is looked up #then each still exists", () => {
    expect(retirementProblems(HELD_ANSWERS, exportedIn)).toEqual([])
  })

  test("#given an entry whose export is gone, and one with neither rows nor an export #when checked #then each is named", () => {
    const gone = { rows: [], retiredWith: { file: "x.ts", symbol: "gone" } }
    expect(retirementProblems({ "site-a": gone, "site-b": { rows: [] } }, () => false)).toEqual([
      "site-a: gone left x.ts; its slice removes this entry in the same commit",
      "site-b: names no row and no retiredWith export, so nothing retires it",
    ])
  })

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
