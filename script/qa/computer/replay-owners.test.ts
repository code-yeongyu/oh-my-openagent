import { describe, expect, test } from "bun:test"
import { classify, type Ledgers, type Outcome } from "./replay-owners"

const DIR = "crates/omo-computer-core/fixtures/conformance"
const OLD = "crates/senpi-desktop-core/fixtures/conformance"
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
  ),
}

const failed = (name: string): Outcome => ({ name: `${DIR}/${name}`, status: "failed" })
const verdict = (name: string, row = 20) => classify(row, [failed(name)], LEDGERS).lines[0]

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

  test("(b) an imported case with a delta or leg due at or before N fails, a passed leg fails", () => {
    expect(verdict("delta-due.json")).toStartWith("FAIL ")
    expect(verdict("leg-due.json")).toStartWith("FAIL ")
    expect(verdict("leg-due.json", 19)).toBe(`owed ${DIR}/leg-due.json row 20`)
    expect(verdict("leg-passed.json")).toStartWith("FAIL ")
  })

  test("(c) an imported case owed only to later rows is owed to the row the ledgers name", () => {
    expect(verdict("delta-later.json")).toBe(`owed ${DIR}/delta-later.json row 31`)
    expect(verdict("leg-owed.json")).toBe(`owed ${DIR}/leg-owed.json row 27`)
  })

  test("(d) a mismatching case with no owner, or only a pending manifest row, fails unowned", () => {
    expect(verdict("orphan.json")).toBe(`FAIL ${DIR}/orphan.json unowned`)
    expect(verdict("pending.json")).toBe(`FAIL ${DIR}/pending.json unowned`)
    expect(verdict("never-imported.json")).toBe(`FAIL ${DIR}/never-imported.json unowned`)
  })

  test("the summary counts every outcome and only the failing set fails the run", () => {
    const outcomes: Outcome[] = [
      { name: `${DIR}/hello.json`, status: "ok" },
      { name: "v3-old.json", status: "skipped" },
      failed("delta-later.json"),
      failed("orphan.json"),
    ]
    const result = classify(20, outcomes, LEDGERS)
    expect(result.lines).toEqual([
      `owed ${DIR}/delta-later.json row 31`,
      `FAIL ${DIR}/orphan.json unowned`,
      "replay-all R57 row=20: ok=1 skipped=1 failing=1 owed=1",
    ])
    expect(result.failing).toBe(1)
    const clean = classify(20, [outcomes[0], outcomes[1], outcomes[2]], LEDGERS)
    expect(clean.lines.at(-1)).toBe("replay-all R57 row=20: ok=1 skipped=1 failing=0 owed=1")
    expect(clean.failing).toBe(0)
  })
})
