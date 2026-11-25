import { describe, expect, test } from "bun:test"

import {
  BEHAVIOUR_CHANGES,
  type BehaviourChange,
  CUSTODY_RESULTS,
  GATED,
  type MatrixLine,
  PRINCIPAL_MATRIX,
  REFUSALS,
  SOURCE_CODES,
} from "../../packages/omo-senpi/src/components/omo-sdk/contract"
import { behaviourChangeProblems, matrixProblems, refusalScenarioProblems } from "./authority-check"
import { CUSTODY_FIELDS, HELD } from "./authority-expected"
import { calls, files, isTyped, json, rows, securityDesign } from "./authority-scope"
import { custodyResultProblems, gatedProblems, principalInputProblems } from "./custody-check"
import type { ScenarioTableFile, TableScenario } from "./scenario-table"

// Negative controls of slice P1a-s's checks (#14949): each breaks one thing the real tree holds and expects the check to
// name it, so a check that stopped looking would fail here.
const SPLIT = PRINCIPAL_MATRIX.find((line) => line.split !== undefined)
const SHARED = PRINCIPAL_MATRIX.find((line) => line.split === undefined && line.rows.length > 0)
const withLine = (line: MatrixLine): MatrixLine[] => PRINCIPAL_MATRIX.map((l) => (l === SHARED ? line : l))
const matrix = (lines: readonly MatrixLine[]): string =>
  matrixProblems(lines, rows, securityDesign, SOURCE_CODES).join("\n")
const editScenario = (id: string, edit: (scenario: TableScenario) => TableScenario | undefined): ScenarioTableFile[] =>
  files.map((file) => ({
    ...file,
    scenarios: file.scenarios.flatMap((scenario) => {
      if (scenario.id !== id) return [scenario]
      const next = edit(scenario)
      return next === undefined ? [] : [next]
    }),
  }))
const refusal = REFUSALS.find((entry) => entry.change === undefined)
const b4 = REFUSALS.find((entry) => entry.change === "B4")

describe("negative controls of the principal matrix (#14949)", () => {
  test("#given a shared cell split without the document saying so #then the check names it", () => {
    if (SHARED === undefined) throw new Error("no shared line")
    const split = { ...SHARED, cells: { ...SHARED.cells, script: { outcome: "n/a" as const } } }
    expect(matrix(withLine(split))).toContain("person and script differ without a quote")
  })

  test("#given a split quote the security design does not contain #then the check names it", () => {
    if (SPLIT === undefined) throw new Error("no split line")
    const lines = PRINCIPAL_MATRIX.map((line) => (line === SPLIT ? { ...SPLIT, split: "words nobody wrote" } : line))
    expect(matrix(lines)).toContain("the split quote is not in the security design")
  })

  test("#given a split line merged back into one cell #then the check names it", () => {
    if (SPLIT === undefined) throw new Error("no split line")
    const lines = PRINCIPAL_MATRIX.map((line) =>
      line === SPLIT ? { ...SPLIT, cells: { ...SPLIT.cells, script: SPLIT.cells.person } } : line,
    )
    expect(matrix(lines)).toContain("needs no split")
  })

  test("#given a refused cell with no scenario, or one that touches a port #then the refusal check names it", () => {
    if (refusal === undefined) throw new Error("no refusal")
    const gone = editScenario(refusal.scenario, () => undefined)
    expect(refusalScenarioProblems(REFUSALS, BEHAVIOUR_CHANGES, gone).join("\n")).toContain("no scenario")
    const effect = editScenario(refusal.scenario, (s) => ({ ...s, expect: s.expect.map((e) => ({ ...e, count: 1 })) }))
    expect(refusalScenarioProblems(REFUSALS, BEHAVIOUR_CHANGES, effect).join("\n")).toContain("before any side effect")
  })
})

describe("negative controls of the approved behaviour changes (#14949)", () => {
  test("#given B4's scenario asserting the refusal while its evidence flag is false #then the check names it", () => {
    if (b4 === undefined) throw new Error("no B4 cell")
    const early = editScenario(b4.scenario, (s) => ({
      ...s,
      kind: "refusal",
      refusal: "sender_not_allowed",
      expect: s.expect.map((e) => ({ ...e, count: 0 })),
    }))
    expect(behaviourChangeProblems(BEHAVIOUR_CHANGES, early).join("\n")).toContain("asserts other than B4's today")
  })

  test("#given an entry that exists today with no today expectation, or a flag set with no evidence #then it is named", () => {
    const broken = BEHAVIOUR_CHANGES.map((change): BehaviourChange =>
      change.id === "B4" && change.exists === "today"
        ? { ...change, today: { ...change.today, says: "" }, evidence_present: true }
        : change,
    )
    const found = behaviourChangeProblems(broken, files).join("\n")
    expect(found).toContain("B4: exists today, so it carries today's expectation")
    expect(found).toContain("B4: no change's evidence exists at this head")
  })
})

describe("negative controls of custody and the held table (#14949)", () => {
  const results = Object.fromEntries(Object.entries(CUSTODY_RESULTS).map(([key, schema]) => [key, json(schema)]))

  test("#given a field added to a custody answer #then the check names it, and a secret-shaped one twice", () => {
    const handOver = results["account.credentials.handOver"] ?? { properties: {}, required: [] }
    const leaky = {
      ...results,
      "account.credentials.handOver": {
        ...handOver,
        properties: { ...handOver.properties, access_token: { type: "string" } },
      },
    }
    const found = custodyResultProblems(leaky, CUSTODY_FIELDS).join("\n")
    expect(found).toContain("account.credentials.handOver.access_token: a field a secret could ride in")
    expect(found).toContain("the non-secret set is")
  })

  test("#given a call that takes a principal #then the check names it", () => {
    const send = calls["threads.send"] ?? { properties: {}, required: [] }
    const taking = { ...calls, "threads.send": { ...send, properties: { ...send.properties, principal: {} } } }
    expect(principalInputProblems(taking).join("\n")).toContain("threads.send.principal: a call takes a principal")
  })

  test("#given an entry left in GATED, or one marked typed that is not #then the check names it", () => {
    const back = [{ row: "threads.attach", s0: ["4.1"], reason: "attach", rowExists: true }]
    expect(gatedProblems(back, HELD, isTyped).join("\n")).toContain("GATED threads.attach")
    expect(GATED).toEqual([])
    const missing = [...HELD, { entry: "threads.send#nobody", typed: true }]
    expect(gatedProblems([], missing, isTyped).join("\n")).toContain("threads.send#nobody: left GATED but is not typed")
  })
})
