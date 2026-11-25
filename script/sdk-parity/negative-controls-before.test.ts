import { describe, expect, test } from "bun:test"

import {
  GATED,
  HELD_CODES,
  inputAccepts,
  OMO_CODE_REGISTRY,
  PORT_OPERATIONS,
  ROOT_CALLS,
  ROOT_OPTION_NAMES,
  SECURITY_SECTIONS,
  SOURCE_CODES,
} from "../../packages/omo-senpi/src/components/omo-sdk/contract"
import { callInputOf } from "./call-input"
import { conformanceProblems } from "./conformance"
import { builtRows, CONTEXT, open, pair, run, scenario } from "./conformance-fixture"
import { runEffectScenarios, type ScenarioRun } from "./conformance-run"
import type { Contract } from "./contract-check"
import type { ObservedCall, TableScenario } from "./expectation"
import { allRows, loadDomainFiles } from "./registry"
import { scenarioProblems } from "./scenario-check"
import { loadScenarioTable, type ScenarioTableFile } from "./scenario-table"

// Controls of the before form the design lane ruled for slice C1c (#14960): calls made first on the same fixture,
// their answers named by $answer:<n>, their port calls kept as setup outside the expected trace, a write among them
// allowed only when stated, and a marker of a before-call that failed named.

const contract: Contract = {
  calls: Object.fromEntries(Object.entries(ROOT_CALLS).map(([key, call]) => [key, callInputOf(call.input)])),
  gated: GATED,
  ports: PORT_OPERATIONS,
  sections: SECURITY_SECTIONS,
  rootOptions: ROOT_OPTION_NAMES,
  registry: OMO_CODE_REGISTRY,
  heldCodes: HELD_CODES,
  sourceCodes: SOURCE_CODES,
  accepts: (call, input, exempt) => inputAccepts(call, input, exempt),
}
const rows = allRows(loadDomainFiles())
const files = loadScenarioTable()
const withScenario = (table: TableScenario): ScenarioTableFile[] =>
  files.map((file) =>
    file.domain === table.row.split(".")[0] ? { ...file, scenarios: [...file.scenarios, table] } : file,
  )
const tableProblems = (table: TableScenario): string => scenarioProblems(rows, contract, withScenario(table)).join("\n")

const problems = async (runs: readonly ScenarioRun[]): Promise<string> =>
  conformanceProblems(builtRows, open, await runEffectScenarios(builtRows, runs), CONTEXT).join("\n")
const host = (op: string): ObservedCall => ({ port: "host", op, args: {} })
const base = scenario("by-id", undefined)

// The before-call is threads.locate itself with a marker input; the scenario's call receives its answer under `prior`.
const chained = (allow?: true): TableScenario => ({
  ...base,
  input: { ...base.input, prior: "$answer:1" },
  before: [
    {
      row: "threads.locate",
      input: { ...base.input, probe: true },
      ...(allow === undefined ? {} : { allow_effects: allow }),
    },
  ],
})
const member =
  (before: { answer: unknown; effect?: boolean }) =>
  async (calls: ObservedCall[], input: unknown): Promise<unknown> => {
    if (Reflect.get(Object(input), "probe") === true) {
      if (before.effect === true) calls.push(host("kill"))
      return before.answer
    }
    calls.push({ port: "host", op: "listSessions", args: { allScope: false } })
    return { kind: "ok", value: { prior: Reflect.get(Object(input), "prior") } }
  }

describe("before: setup calls, their answers and their effects", () => {
  test("#given a before-call that answered #then the scenario's call receives its value and the setup stays out of the trace", async () => {
    const answered = { ...chained(true), answer: { value: { prior: { seen: 1 } } } }
    const found = await problems([
      run(answered, undefined, member({ answer: { kind: "ok", value: { seen: 1 } }, effect: true })),
      ...pair.slice(1),
    ])
    expect(found).not.toContain("by-id")
  })

  test("#given a marker whose before-call failed #then it is named", async () => {
    const found = await problems([
      run(chained(), undefined, member({ answer: { kind: "error", error: { code: "not_found" } } })),
      ...pair.slice(1),
    ])
    expect(found).toContain("$answer:1 names a before-call that did not answer a success")
  })

  test("#given a before-call that makes an effect without allow_effects #then the setup write is named", async () => {
    const found = await problems([
      run(chained(), undefined, member({ answer: { kind: "ok", value: {} }, effect: true })),
      ...pair.slice(1),
    ])
    expect(found).toContain(
      "before[0] (threads.locate) made the effect host.kill; a before-call is a read unless it states allow_effects",
    )
  })

  test("#given a before-call on another namespace #then the table check names it", () => {
    expect(
      tableProblems({
        ...chained(),
        id: "threads.locate/before-elsewhere",
        before: [{ row: "install.version", input: {} }],
      }),
    ).toContain("before[0] calls install.version, outside the scenario's namespace")
  })

  test("#given a marker past the last before-call #then the table check names it", () => {
    expect(
      tableProblems({ ...chained(), id: "threads.locate/before-short", input: { ...base.input, prior: "$answer:2" } }),
    ).toContain("prior names $answer:2, but the scenario has 1 before-call(s)")
  })

  // install.setup.apply: plan is the marked field; consent, its companion, is still checked against the schema.
  const marked = (input: Record<string, unknown>): TableScenario => ({
    id: "install.setup.apply/control-marked-companion",
    row: "install.setup.apply",
    kind: "effect",
    before: [{ row: "install.setup.plan", input: {} }],
    input,
    expect: [{ port: "fs", op: "write", args: { path: "<agent-dir>/auth.json" } }],
  })

  test("#given a marked input whose companion field has the wrong type #then the schema check still refuses it", () => {
    expect(tableProblems(marked({ plan: "$answer:1", consent: "some" }))).toContain(
      "install.setup.apply's schema refuses its input",
    )
  })

  test("#given a marked input missing a required companion field #then the schema check still refuses it", () => {
    expect(tableProblems(marked({ plan: "$answer:1" }))).toContain("install.setup.apply's schema refuses its input")
  })

  test("#given a marked input whose companions are valid #then the schema check accepts it", () => {
    expect(tableProblems(marked({ plan: "$answer:1", consent: "all" }))).not.toContain(
      "control-marked-companion: install.setup.apply's schema refuses its input",
    )
  })

  test("#given a before-call input its row's schema refuses #then the table check names it", () => {
    expect(
      tableProblems({
        ...chained(),
        id: "threads.locate/before-bad",
        before: [{ row: "threads.locate", input: { thread: 7 } }],
      }),
    ).toContain("before[0]'s input is not one threads.locate's schema accepts")
  })
})
