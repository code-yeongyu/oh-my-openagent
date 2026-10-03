import { describe, expect, test } from "bun:test"

import { CONTROL_ID, evaluateShardFaultReport, SCENARIO_IDS } from "./task-host-e2e-shards-eval.mjs"

function complete(mode = "full") {
  const ids = mode === "control" ? [CONTROL_ID] : SCENARIO_IDS
  return {
    mode,
    scenarios: Object.fromEntries(ids.map((id) => [id, { status: "pass", evidence: [`${id}.json`] }])),
  }
}

describe("evaluateShardFaultReport", () => {
  test("all twenty-four full-run rules with evidence pass", () => {
    const verdict = evaluateShardFaultReport(complete())
    expect(SCENARIO_IDS).toHaveLength(25)
    expect(verdict).toMatchObject({ exitCode: 0, verdict: "PASS", expected: 25, passed: 25, failed: [] })
  })

  test("every full-run rule independently fails when broken", () => {
    for (const id of SCENARIO_IDS) {
      const report = complete()
      report.scenarios[id] = { status: "fail", evidence: [`${id}.json`], reason: "mutated" }
      const verdict = evaluateShardFaultReport(report)
      expect(verdict.exitCode).toBe(1)
      expect(verdict.failed).toEqual([id])
    }
  })

  test("a pass without evidence fails", () => {
    const report = complete()
    report.scenarios[SCENARIO_IDS[0]] = { status: "pass", evidence: [] }
    expect(evaluateShardFaultReport(report).failed).toEqual([SCENARIO_IDS[0]])
  })

  test("the control requires the shared-host cascade row", () => {
    expect(evaluateShardFaultReport(complete("control"))).toMatchObject({
      exitCode: 0,
      verdict: "PASS",
      expected: 1,
      passed: 1,
    })
    const report = complete("control")
    report.scenarios[CONTROL_ID].status = "fail"
    expect(evaluateShardFaultReport(report)).toMatchObject({
      exitCode: 1,
      failed: [CONTROL_ID],
    })
  })

  test("unexpected rows fail closed", () => {
    const report = complete()
    report.scenarios.max_depth_bounded = { status: "pass", evidence: ["forbidden.json"] }
    const verdict = evaluateShardFaultReport(report)
    expect(verdict.exitCode).toBe(1)
    expect(verdict.unexpected).toEqual(["max_depth_bounded"])
  })

  test("an extra contract gate can fail without substituting a scenario row", () => {
    const report = complete()
    report.gates = {
      contracts: { status: "fail", evidence: ["contract-tests.log"] },
    }
    const verdict = evaluateShardFaultReport(report)
    expect(verdict.exitCode).toBe(1)
    expect(verdict.failed).toEqual([])
    expect(verdict.failedGates).toEqual(["contracts"])
  })
})
