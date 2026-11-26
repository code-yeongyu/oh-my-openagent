import { describe, expect, test } from "bun:test"

import { IDS, ROW, run, train12 } from "./presentation-fixture"

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

  test("#given two rows for different verbs of the same scenario #then both stand and neither is refused", () => {
    const close = { ...ROW, verb: "remote close", changes: [{ before: "a", after: "b" }] }
    const report = run(train12, [ROW, close])
    expect(report.failures).toEqual([])
    expect(report.presentation).toEqual(IDS.toSorted())
  })

  test("#given a row that names no changed line #then the row is refused", () => {
    const report = run(train12, [ROW, { ...ROW, verb: "remote close", changes: [] }])
    expect(report.failures).toEqual([
      "script/sdk-parity/presentation.json: the row for remote close names no changed line",
    ])
  })
})
