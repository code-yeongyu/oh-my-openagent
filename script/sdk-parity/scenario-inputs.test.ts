import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { ROOT_CALLS, type RootCallKey } from "../../packages/omo-senpi/src/components/omo-sdk/contract"
import { inputAccepts } from "../../packages/omo-senpi/src/components/omo-sdk/contract/validate"
import { FORMAT_CHECKED } from "../../packages/omo-senpi/test-support/omo-sdk-sample-input"
import { decodeFixtures } from "./bytes-fixtures"

// Every scenario input the table states must be an input the root's boundary accepts (its call's schema and the fields
// the root checks beyond it), unless the scenario is about an invalid input. A placeholder the boundary refuses never
// exercises the call it names, so the scenario would pass or fail for the wrong reason.
type Scenario = { readonly id: string; readonly row: string; readonly input?: unknown; readonly refusal?: string }

const DIR = join(import.meta.dir, "scenarios")
const scenarios: readonly Scenario[] = readdirSync(DIR)
  .filter((name) => name.endsWith(".json"))
  .flatMap((name) => (JSON.parse(readFileSync(join(DIR, name), "utf8")) as { scenarios: Scenario[] }).scenarios)

function refusedAtBoundary(scenario: Scenario): string | undefined {
  const key = scenario.row as RootCallKey
  const problems: string[] = []
  const input = decodeFixtures(scenario.input ?? {}, problems, scenario.id)
  if (problems.length > 0) return problems.join("; ")
  if (!inputAccepts(key, input)) return "outside the call's schema"
  const fields = typeof input === "object" && input !== null ? Object.entries(input) : []
  const bad = fields.filter(
    ([field, value]) => FORMAT_CHECKED[field] !== undefined && !FORMAT_CHECKED[field].accepts(value),
  )
  return bad.length === 0 ? undefined : `${bad.map(([field]) => field).join(", ")} fails the root's format check`
}

describe("the scenario table's inputs", () => {
  test("#given every scenario of a root call that is not about an invalid input #then the root's boundary accepts its input", () => {
    const checked = scenarios.filter(
      (scenario) => scenario.row in ROOT_CALLS && scenario.refusal !== "invalid_arguments",
    )
    expect(checked.length).toBeGreaterThan(1000)
    expect(
      checked.flatMap((scenario) => {
        const reason = refusedAtBoundary(scenario)
        return reason === undefined ? [] : [`${scenario.id}: ${reason}`]
      }),
    ).toEqual([])
  })

  test("#given a placeholder module URL #then the check names it (control)", () => {
    expect(
      refusedAtBoundary({
        id: "control",
        row: "threads.extensions.register",
        input: { name: "x", migrations: [["create table t (id)"]], moduleUrl: "x-moduleUrl", sessionCallable: [] },
      }),
    ).toBe("moduleUrl fails the root's format check")
  })
})
