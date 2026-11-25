import { describe, expect, test } from "bun:test"

import {
  GATED,
  HELD_CODES,
  inputAccepts,
  OMO_CODE_REGISTRY,
  PORTS,
  ROOT_CALLS,
  SOURCE_CODES,
} from "../../packages/omo-senpi/src/components/omo-sdk/contract"
import {
  type CallInput,
  codeProblems,
  type Contract,
  inputProblems,
  scenarioProblems,
  scopeProblems,
} from "./contract-check"
import { allRows, loadDomainFiles } from "./registry"
import type { Row } from "./schema"
import { loadScenarioTable, type TableScenario, type ScenarioTableFile } from "./scenario-table"

// Slice P1a (#14948): the root's type, the code registry, the scenario ids and the input schemas agree with the
// registry rows. Each check also runs once on a fixture that breaks it.

const asInput = (schema: unknown): CallInput => {
  const json = JSON.parse(JSON.stringify(schema)) as Partial<CallInput>
  return { properties: json.properties ?? {}, required: json.required ?? [] }
}

const contract: Contract = {
  calls: Object.fromEntries(Object.entries(ROOT_CALLS).map(([key, call]) => [key, asInput(call.input)])),
  gated: GATED,
  ports: PORTS,
  registry: OMO_CODE_REGISTRY,
  heldCodes: HELD_CODES,
  sourceCodes: SOURCE_CODES,
  accepts: (call, input) => inputAccepts(call, input),
}

const rows = allRows(loadDomainFiles())
const scenarios = loadScenarioTable()

describe("SDK contract of slice P1a (#14948)", () => {
  test("#given the registry rows #then the root type has one call per P1a row and holds the rest for P1a-s", () => {
    expect(scopeProblems(rows, contract)).toEqual([])
  })

  test("#given each P1a call #then its input schema equals its row's input, field by field", () => {
    expect(inputProblems(rows, contract)).toEqual([])
  })

  test("#given the scenario table #then every code a row returns is registered, and every registered code is returned", () => {
    expect(codeProblems(rows, contract, scenarios)).toEqual([])
  })

  test("#given the scenario table #then each scenario is observable and each behaviour input has one", () => {
    expect(scenarioProblems(rows, contract, scenarios)).toEqual([])
  })
})

const firstCall = Object.keys(contract.calls)[0] ?? ""
const rowOf = (sdk: string): Row => {
  const row = rows.find((candidate) => candidate.sdk === sdk)
  if (row === undefined) throw new Error(`no row ${sdk}`)
  return row
}
const withScenario = (files: readonly ScenarioTableFile[], scenario: TableScenario): ScenarioTableFile[] =>
  files.map((file) =>
    file.domain === scenario.row.split(".")[0] ? { ...file, scenarios: [...file.scenarios, scenario] } : file,
  )

describe("negative controls of the P1a checks", () => {
  test("#given a call removed from the root #then the scope check names the row", () => {
    const { [firstCall]: _removed, ...calls } = contract.calls
    expect(scopeProblems(rows, { ...contract, calls }).join("\n")).toContain(`the root type has no call ${firstCall}`)
  })

  test("#given a held field typed on the root #then the scope check names it", () => {
    const held = GATED.find((entry) => entry.field !== undefined && entry.rowExists && entry.row !== "root")
    if (held?.field === undefined) throw new Error("GATED holds no field")
    const sdk = rowOf(held.row).sdk
    const call = contract.calls[sdk] ?? { properties: {}, required: [] }
    const calls = { ...contract.calls, [sdk]: { ...call, properties: { ...call.properties, [held.field]: {} } } }
    expect(scopeProblems(rows, { ...contract, calls }).join("\n")).toContain(`takes ${held.field} on ${sdk}`)
  })

  test("#given a schema field whose type drifted from the row #then the input check names it", () => {
    const sdk = "threads.setModel"
    const call = contract.calls[sdk] ?? { properties: {}, required: [] }
    const calls = {
      ...contract.calls,
      [sdk]: { ...call, properties: { ...call.properties, model: { type: "number" } } },
    }
    expect(inputProblems(rows, { ...contract, calls }).join("\n")).toContain("row threads.setModel input model")
  })

  test("#given a refusal code missing from the registry #then the code check names it", () => {
    const { not_found: _removed, ...registry } = contract.registry
    expect(codeProblems(rows, { ...contract, registry }, scenarios).join("\n")).toContain("code not_found: returned by")
  })

  test("#given a registered code no row returns #then the code check names it", () => {
    const registry = { ...contract.registry, local_only: { namespaces: ["threads"], next_action: "x" } }
    const heldCodes = Object.fromEntries(Object.entries(contract.heldCodes).filter(([code]) => code !== "local_only"))
    expect(codeProblems(rows, { ...contract, registry, heldCodes }, scenarios).join("\n")).toContain(
      "code local_only: no row returns it",
    )
  })

  test("#given a scenario with no observable effect #then the scenario check names it", () => {
    const broken: TableScenario = {
      id: "threads.setModel/nothing",
      row: "threads.setModel",
      kind: "effect",
      input: { thread: "a", model: "m" },
      expect: [],
    }
    expect(scenarioProblems(rows, contract, withScenario(scenarios, broken)).join("\n")).toContain(
      "no observable expected effect",
    )
  })

  test("#given a scenario whose input the schema refuses #then the scenario check names it", () => {
    const broken: TableScenario = {
      id: "threads.setModel/bad-input",
      row: "threads.setModel",
      kind: "effect",
      input: { thread: "a" },
      expect: [{ port: "host", observes: "set_model" }],
    }
    expect(scenarioProblems(rows, contract, withScenario(scenarios, broken)).join("\n")).toContain(
      "schema refuses its input",
    )
  })

  test("#given a behaviour input no scenario exercises #then the scenario check names it", () => {
    const files = scenarios.map((file) => ({
      ...file,
      scenarios: file.scenarios.filter(
        (scenario) => !(scenario.row === "threads.setModel" && "provider" in scenario.input),
      ),
    }))
    expect(scenarioProblems(rows, contract, files).join("\n")).toContain(
      "row threads.setModel: input provider changes no effect scenario",
    )
  })

  test("#given a row naming a scenario id the table lacks #then the scenario check names it", () => {
    const patched = rows.map((row) =>
      row.id === "threads.setModel"
        ? { ...row, scenarios: { effect: ["threads.setModel/missing"], refusal: [] } }
        : row,
    )
    expect(scenarioProblems(patched, contract, scenarios).join("\n")).toContain(
      "scenario threads.setModel/missing is not in the scenario table",
    )
  })
})
