import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { tmpdir } from "node:os"

import { PORT_EFFECTS } from "../../packages/omo-senpi/src/components/omo-sdk/contract/ports"
import { type ConformanceContext, conformanceProblems, type EffectEvidence } from "./conformance"
import { runEffectScenarios } from "./conformance-run"
import { FAKE_HOME_PREFIX } from "./fakes/setup"
import { allRows, loadDomainFiles } from "./registry"
import { runs } from "./runs/install"
import { loadScenarioTable } from "./scenario-table"

// Slice C1c's drivers (#14960) judged as the gate will judge the install rows once they list their scenarios: every
// install scenario of the table has one run over the real omo SDK root, and each row conforms with the real effect
// classification. OpenCode's fixture key (runs/install.ts) never reaches a record.

const table = loadScenarioTable()
const scenarios = table.flatMap((file) => file.scenarios).filter((scenario) => scenario.row.startsWith("install."))
const served = new Set(runs.map((run) => run.scenario.row))
const rows = allRows(loadDomainFiles())
  .filter((row) => served.has(row.id))
  .map((row) => ({
    ...row,
    scenarios: {
      effect: scenarios.filter((s) => s.row === row.id && s.kind === "effect").map((s) => s.id),
      refusal: scenarios.filter((s) => s.row === row.id && s.kind === "refusal").map((s) => s.id),
    },
  }))
const CONTEXT: ConformanceContext = {
  effects: PORT_EFFECTS,
  inert: new Set(table.flatMap((file) => Object.keys(file.inert))),
}

const leftovers = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith(FAKE_HOME_PREFIX))
afterEach(() => {
  expect(leftovers()).toEqual([])
})

let evidence: EffectEvidence[] = []
beforeAll(async () => {
  evidence = await runEffectScenarios(rows, runs)
}, 120_000)

describe("C1c scenario drivers over the real omo SDK root", () => {
  test("#given runs/install.ts #then every scenario of the six install rows it serves has exactly one run", () => {
    expect([...served].toSorted()).toEqual([
      "install.sdkRoot",
      "install.setup.apply",
      "install.setup.detect",
      "install.setup.plan",
      "install.update",
      "install.version",
    ])
    expect(runs.map((run) => run.scenario.id).toSorted()).toEqual(
      scenarios
        .filter((s) => served.has(s.row))
        .map((s) => s.id)
        .toSorted(),
    )
  })

  // install.sdkRoot is slice P1b's row, refused by default at the root until its authority cell lands: its scenario runs
  // here (one runs module per namespace) and is judged by P1b's clearing, not by this slice.
  test("#given every run's record #then each of C1c's install rows conforms", () => {
    const judged = rows.filter((row) => row.id !== "install.sdkRoot")
    expect(conformanceProblems(judged, new Set(), evidence, CONTEXT)).toEqual([])
  })

  test("#given every run's record #then OpenCode's fixture key is in none", () => {
    expect(JSON.stringify(evidence)).not.toContain("sk-c1c-fixture-not-a-secret")
  })
})
