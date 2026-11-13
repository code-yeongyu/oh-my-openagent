import { describe, expect, test } from "bun:test"
import { join, relative } from "node:path"
import { casesIn, ROOT } from "./replay-case"
import { classify, type Ledgers, type Outcome, readLedgers } from "./replay-owners"

const DIR = "crates/omo-computer-core/fixtures/conformance"
const V1 = "crates/omo-computer-engine/tests/fixtures/v1-consumers"
const OLD = "fixtures/old-corpus"
const tsv = (...rows: string[][]) => rows.map((row) => row.join("\t")).join("\n") + "\n"

// Fake ledgers with the column headers of crates/omo-computer-core/parity/*.tsv.
const LEDGERS: Ledgers = {
  manifest: tsv(
    ["unit", "kind", "test id", "status", "note"],
    [`${OLD}/ported.json`, "fixture", `${OLD}/ported.json`, `ported:${DIR}/ported.json`, "modified"],
    [`${OLD}/pending.json`, "fixture", `${OLD}/pending.json`, "pending", "added"],
  ),
  provenance: tsv(
    ["new path", "old path", "base sha", "old sha256", "new sha256", "substitutions"],
    ...["ported", "pending", "delta-due", "delta-later", "leg-owed", "leg-due", "leg-passed", "orphan"].map((n) => [
      `${DIR}/${n}.json`,
      `${OLD}/${n}.json`,
      "d79b",
      "a",
      "b",
      "",
    ]),
  ),
  deltas: tsv(
    ["file", "pointer", "kind", "source", "row", "imported value", "v3 value"],
    [`${DIR}/delta-due.json`, "/result/a", "additive", "design row C2", "12", "", ""],
    [`${DIR}/delta-later.json`, "/result/a", "additive", "design row C2", "31", "", ""],
  ),
  deferred: tsv(
    ["design row", "leg", "recorded by row", "owed to row", "status"],
    ["C3", "the replay of `leg-owed.json` on every persona", "13", "27", "owed"],
    ["C3", "an earlier leg of `leg-owed.json`", "13", "23", "owed"],
    ["C4", "`leg-due.json` byte-equal", "13", "20", "owed"],
    ["C5", "`leg-passed.json` replays", "13", "40", "passed:some::test"],
    ["C6", "`v3-later.json` is owed", "16", "40", "owed"],
    ["C7", "`leg-23.json` replays", "20", "23", "owed"],
    ["C7", "`leg-17.json` replays", "16", "17", "owed"],
    ["T1", `replay of the imported case \`${V1}/02-owned.json\` exits 0`, "20", "28", "owed"],
    ["T1", "replay of `crates/other/fixtures/03-elsewhere.json` exits 0", "20", "28", "owed"],
  ),
}

// A fake plan in the row format of the computer-use v3 plan: 26 -> 23 -> 20 -> 17, and 55 -> 7, 20.
const PLAN = [
  "- [ ] 7. Spike",
  "  Parallelization: Wave 4 | Blocked by: 5 | Blocks: 55",
  "- [ ] 17. Session",
  "  Parallelization: Wave 8 | Blocked by: - | Blocks: 20",
  "- [x] 19. Settle",
  "  Parallelization: Wave 11 | Blocked by: 17, 20 | Blocks: 28",
  "- [ ] 20. Frames",
  "  Parallelization: Wave 10 | Blocked by: 17 | Blocks: 23, 55",
  "- [ ] 23. Holds",
  "  Parallelization: Wave 12 | Blocked by: 20 | Blocks: 26",
  "- [ ] 26. Remote typing",
  "  Parallelization: Wave 13 | Blocked by: 23 | Blocks: -",
  "- [ ] 55. Windows capture",
  "  Parallelization: Wave 20 | Blocked by: 7, 20 | Blocks: -",
  "- [ ] F1. Plan compliance audit",
  "  Parallelization: final | Blocked by: 26 | Blocks: -",
].join("\n")

const failed = (name: string): Outcome => ({ name: `${DIR}/${name}`, status: "failed" })
const verdict = (name: string, row = 20) => classify(row, [failed(name)], LEDGERS, PLAN).lines[0]

describe("R57 replay-all classification", () => {
  test("(a) a v3 case named for a row at or before N fails, a later row's name is looked up", () => {
    expect(verdict("v3-r17-marker.json")).toStartWith(`FAIL ${DIR}/v3-r17-marker.json `)
    expect(verdict("v3-r20-marker.json")).toStartWith("FAIL ")
    expect(verdict("v3-r21-marker.json", 20)).toStartWith("FAIL ")
    expect(verdict("v3-r21-marker.json", 20)).toContain("unowned")
  })

  test("(a) a plain v3 case in the row-N checkout fails even when a ledger owes it later", () => {
    expect(verdict("v3-later.json")).toStartWith(`FAIL ${DIR}/v3-later.json `)
  })

  test("(b) an imported case the manifest marks ported fails", () => {
    expect(verdict("ported.json")).toStartWith(`FAIL ${DIR}/ported.json `)
  })

  test("(b) an ORACLE-DELTAS row records a delta, it neither makes a case due nor owns it", () => {
    expect(verdict("delta-due.json", 17)).toBe(`FAIL ${DIR}/delta-due.json unowned`)
    expect(verdict("delta-due.json", 17)).not.toContain("due at row 12")
    expect(verdict("delta-later.json")).toBe(`FAIL ${DIR}/delta-later.json unowned`)
  })

  test("(b) an imported case with a leg due at N or a blocker of N fails, a passed leg fails", () => {
    expect(verdict("leg-due.json")).toStartWith("FAIL ")
    expect(verdict("leg-due.json", 19)).toStartWith("FAIL ")
    expect(verdict("leg-due.json", 17)).toBe(`owed ${DIR}/leg-due.json row 20`)
    expect(verdict("leg-passed.json")).toStartWith("FAIL ")
  })

  test("(b) R57e: a due row is due at N only when it is N or a transitive blocker of N in the plan", () => {
    expect(verdict("leg-23.json", 55)).toBe(`owed ${DIR}/leg-23.json row 23`)
    expect(verdict("leg-owed.json", 55)).toBe(`owed ${DIR}/leg-owed.json row 27`)
    expect(verdict("leg-23.json", 26)).toStartWith(`FAIL ${DIR}/leg-23.json due at row 23 `)
    expect(verdict("leg-17.json", 55)).toStartWith(`FAIL ${DIR}/leg-17.json due at row 17 `)
    expect(verdict("leg-23.json", 23)).toStartWith("FAIL ")
  })

  test("(b) R57e: a row the plan does not list is an input error", () => {
    expect(() => classify(99, [], LEDGERS, PLAN)).toThrow("row 99")
  })

  test("(c) an imported case owed only to later rows is owed to the row the ledgers name", () => {
    expect(verdict("leg-owed.json")).toBe(`owed ${DIR}/leg-owed.json row 27`)
  })

  test("(d) a mismatching case with no owner, or only a pending manifest row, fails unowned", () => {
    expect(verdict("orphan.json")).toBe(`FAIL ${DIR}/orphan.json unowned`)
    expect(verdict("pending.json")).toBe(`FAIL ${DIR}/pending.json unowned`)
    expect(verdict("never-imported.json")).toBe(`FAIL ${DIR}/never-imported.json unowned`)
  })

  test("(b) a leg owns a case outside the conformance dir by its path, not by a same-named file elsewhere", () => {
    const v1 = (file: string) => classify(20, [{ name: `${V1}/${file}`, status: "failed" }], LEDGERS, PLAN).lines[0]
    expect(v1("02-owned.json")).toBe(`owed ${V1}/02-owned.json row 28`)
    expect(v1("03-elsewhere.json")).toBe(`FAIL ${V1}/03-elsewhere.json unowned`)
    expect(v1("04-unowned.json")).toBe(`FAIL ${V1}/04-unowned.json unowned`)
  })

  test("(c) the parity ledgers owe every v1-consumers case to a later row at row 20", async () => {
    const ledgers = await readLedgers(join(ROOT, "crates/omo-computer-core/parity"))
    const cases = (await casesIn(join(ROOT, V1))).map((path) => relative(ROOT, path))
    expect(cases.length).toBeGreaterThan(0)
    const outcomes = cases.map((name): Outcome => ({ name, status: "failed" }))
    const { lines } = classify(20, outcomes, ledgers, PLAN)
    for (const [i, name] of cases.entries()) expect(lines[i]).toStartWith(`owed ${name} row `)
  })

  test("the summary counts every outcome and only the failing set fails the run", () => {
    const outcomes: Outcome[] = [
      { name: `${DIR}/hello.json`, status: "ok" },
      { name: "v3-old.json", status: "skipped" },
      failed("leg-owed.json"),
      failed("orphan.json"),
    ]
    const result = classify(20, outcomes, LEDGERS, PLAN)
    expect(result.lines).toEqual([
      `owed ${DIR}/leg-owed.json row 27`,
      `FAIL ${DIR}/orphan.json unowned`,
      "replay-all R57 row=20: ok=1 skipped=1 failing=1 owed=1",
    ])
    expect(result.failing).toBe(1)
    const clean = classify(20, [outcomes[0], outcomes[1], outcomes[2]], LEDGERS, PLAN)
    expect(clean.lines.at(-1)).toBe("replay-all R57 row=20: ok=1 skipped=1 failing=0 owed=1")
    expect(clean.failing).toBe(0)
  })
})
