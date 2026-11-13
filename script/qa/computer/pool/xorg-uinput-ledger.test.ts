import { describe, expect, test } from "bun:test"

import {
  combine,
  hasRawKeyPress,
  type LedgerRow,
  ledgerTsv,
  parseXiServerVersion,
  QUESTIONS,
  summaryLines,
  xiAtLeast21,
} from "./xorg-uinput-ledger.ts"

const rawPress = (device: number, source: number, detail: number) =>
  `EVENT type 13 (RawKeyPress)\n    device: ${device} (${source})\n    detail: ${detail}\n    valuators:\n`

describe("xinput output readers", () => {
  test("server XI version is read from its own line, absent when missing", () => {
    expect(parseXiServerVersion("xinput version 1.6.3\nXI version on server: 2.4\n")).toEqual({ major: 2, minor: 4 })
    expect(parseXiServerVersion("xinput version 1.6.3\n")).toBeNull()
    expect(xiAtLeast21({ major: 2, minor: 1 })).toBe(true)
    expect(xiAtLeast21({ major: 2, minor: 0 })).toBe(false)
  })

  test("a RawKeyPress counts only from the named device and keycode", () => {
    const out = `EVENT type 2 (KeyPress)\n    device: 12 (12)\n    detail: 191\n${rawPress(3, 9, 191)}${rawPress(3, 12, 191)}`
    expect(hasRawKeyPress(out, 12, 191)).toBe(true)
    expect(hasRawKeyPress(out, 12, 192)).toBe(false)
    expect(hasRawKeyPress(out, 14, 191)).toBe(false)
    expect(hasRawKeyPress(out, 9, null)).toBe(true)
    expect(hasRawKeyPress("EVENT type 2 (KeyPress)\n    device: 12 (12)\n    detail: 191\n", 12, 191)).toBe(false)
  })
})

describe("ledger grading", () => {
  test("[ADP-5] runs that disagree are FLAKY, agreeing runs keep their verdict", () => {
    expect(
      combine([
        { verdict: "CONFIRMS", observed: "a" },
        { verdict: "CONFIRMS", observed: "b" },
      ]),
    ).toEqual({ verdict: "CONFIRMS", agree: "2/2" })
    expect(
      combine([
        { verdict: "CONFIRMS", observed: "a" },
        { verdict: "UNMEASURED", observed: "b" },
      ]),
    ).toEqual({ verdict: "FLAKY", agree: "1/2" })
    expect(combine([])).toEqual({ verdict: "UNMEASURED", agree: "0/0" })
  })

  const rows = (verdictOf: (id: string) => LedgerRow["verdict"]): LedgerRow[] =>
    QUESTIONS.map((q) => ({
      ...q,
      verdict: verdictOf(q.id),
      runs: "3/3",
      rerun: "r",
      observed: "o\tx",
      hostBuild: "h",
    }))

  test("summary names both acceptance facts on a full pass", () => {
    expect(summaryLines(rows(() => "CONFIRMS"))).toEqual([
      "uinput=writable",
      "xi_raw=2.1+",
      `PROBE xorg-uinput verdict=pass rows=${QUESTIONS.length}`,
    ])
  })

  test("summary names the first leg the runner could not carry", () => {
    const lines = summaryLines(rows((id) => (id === "xi-raw-delivery" ? "UNMEASURED" : "CONFIRMS")))
    expect(lines).toEqual([
      "uinput=writable",
      "xi_raw=absent",
      "PROBE xorg-uinput verdict=fail: hosted runner cannot carry xi-raw-delivery (UNMEASURED)",
    ])
  })

  test("the ledger is one header and one tab-separated row per question, tabs inside cells flattened", () => {
    const lines = ledgerTsv(rows(() => "CONFIRMS"))
      .trimEnd()
      .split("\n")
    expect(lines).toHaveLength(QUESTIONS.length + 1)
    expect(lines.every((l) => l.split("\t").length === 8)).toBe(true)
  })
})
