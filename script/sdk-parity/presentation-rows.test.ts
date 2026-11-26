import { describe, expect, test } from "bun:test"

import { renderReport } from "./gate"
import { base, IDS, ROW, run, train12 } from "./presentation-fixture"

// Security contract of the changed-capability gate (design 7.4): a presentation.json row clears only the scenarios it
// names, a row naming a scenario the gate does not run is refused, and one verb of one scenario has at most one row.

describe("presentation rows: a row owns only the scenarios it names", () => {
  test("#given a row naming only native-remote-help #then it clears that scenario and the other two still fail", () => {
    const report = run(train12, [{ ...ROW, scenarios: ["native-remote-help"] }])
    expect(report.presentation).toEqual(["native-remote-help"])
    expect(report.failures).toHaveLength(2)
    expect(report.failures.join("\n")).toContain(
      "no row of script/sdk-parity/presentation.json names scenario native-remote-unknown",
    )
    expect(report.failures.join("\n")).toContain(
      "no row of script/sdk-parity/presentation.json names scenario native-remote-open-no-device",
    )
  })

  test("#given a row naming a scenario id that does not exist #then the row is refused", () => {
    const report = run(train12, [{ ...ROW, scenarios: [...IDS, "native-remote-teleport"] }])
    expect(report.failures).toEqual([
      "script/sdk-parity/presentation.json: the row for remote send names scenario native-remote-teleport, which does not exist",
    ])
  })

  test("#given two rows claiming the same verb of the same scenario #then the duplicate is refused", () => {
    const report = run(train12, [ROW, { ...ROW, scenarios: ["native-remote-help"] }])
    expect(report.failures).toEqual([
      "script/sdk-parity/presentation.json: scenario native-remote-help has two rows for remote send",
    ])
  })

  test("#given two rows for different verbs of the same scenario #then both stand, and only the row that matched a changed line is reported and digested", () => {
    const close = { ...ROW, verb: "remote close", changes: [{ before: "a", after: "b" }] }
    const report = run(train12, [ROW, close])
    expect(report.failures).toEqual([])
    expect(report.presentation).toEqual(IDS.toSorted())
    expect(report.presentationRows).toEqual(IDS.toSorted().map((id) => `${id}#presentation=remote send`))
    expect(report.digest).toBe(run(train12).digest)
  })

  test("#given the row already on the merge base #then it does not clear the delta: only a row the pull request adds counts", () => {
    const report = run(train12, [ROW], undefined, [ROW])
    expect(report.presentation).toEqual([])
    expect(report.failures).toHaveLength(3)
    for (const failure of report.failures)
      expect(failure).toContain("no row of script/sdk-parity/presentation.json names scenario")
  })

  test("#given a base row that would be refused today and no delta #then an unrelated pull request stays green", () => {
    const stale = { ...ROW, scenarios: ["native-remote-gone"], changes: [] }
    const report = run((outcome) => outcome, [stale], base, [stale])
    expect(report.failures).toEqual([])
    expect(report.presentation).toEqual([])
  })

  test("#given a presentation pass #then the output names the scenario and the row's verb, and the digest covers that pair", () => {
    const report = run(train12)
    expect(report.presentationRows).toEqual(IDS.toSorted().map((id) => `${id}#presentation=remote send`))
    expect(renderReport(report)).toContain("ids=native-remote-help#presentation=remote send,")
    expect(run(train12, [{ ...ROW, verb: "remote send", reason: "other" }]).digest).toBe(report.digest)
  })

  test("#given a row that names no changed line #then the row is refused", () => {
    const report = run(train12, [ROW, { ...ROW, verb: "remote close", changes: [] }])
    expect(report.failures).toEqual([
      "script/sdk-parity/presentation.json: the row for remote close names no changed line",
    ])
  })
})
