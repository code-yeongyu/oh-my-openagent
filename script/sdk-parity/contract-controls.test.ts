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
import { codeProblems, type Contract, inputProblems, scopeProblems } from "./contract-check"
import { expectationProblems } from "./expectation"
import { scenarioProblems } from "./scenario-check"
import { allRows, loadDomainFiles } from "./registry"
import type { Row } from "./schema"
import { loadScenarioTable, type ScenarioTableFile, type TableScenario } from "./scenario-table"

// Negative controls of the P1a checks (design 7.6): each check fails on one fixture that breaks it, with a message that
// names what to fix.

const contract: Contract = {
  calls: Object.fromEntries(Object.entries(ROOT_CALLS).map(([key, call]) => [key, callInputOf(call.input)])),
  gated: GATED,
  ports: PORT_OPERATIONS,
  sections: SECURITY_SECTIONS,
  rootOptions: ROOT_OPTION_NAMES,
  registry: OMO_CODE_REGISTRY,
  heldCodes: HELD_CODES,
  sourceCodes: SOURCE_CODES,
  accepts: (call, input) => inputAccepts(call, input),
}
const rows = allRows(loadDomainFiles())
const scenarios = loadScenarioTable()
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
    // GATED is empty since slice P1a-s (#14949) typed every entry, so the control holds a typed field again.
    const held = {
      row: "threads.send",
      field: "author",
      s0: ["4.1"],
      reason: "a connector's identity",
      rowExists: true,
    }
    expect(GATED).toEqual([])
    const sdk = rowOf(held.row).sdk
    expect(scopeProblems(rows, { ...contract, gated: [held] }).join("\n")).toContain(`takes ${held.field} on ${sdk}`)
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
    const registry = { ...contract.registry, orphaned: { namespaces: ["threads"], next_action: "x" } }
    const heldCodes = Object.fromEntries(Object.entries(contract.heldCodes).filter(([code]) => code !== "orphaned"))
    expect(codeProblems(rows, { ...contract, registry, heldCodes }, scenarios).join("\n")).toContain(
      "code orphaned: no row returns it",
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
      expect: [{ port: "host", op: "set_model" }],
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
    const problems = scenarioProblems(patched, contract, scenarios).join("\n")
    expect(problems).toContain("scenario threads.setModel/missing is not in the scenario table")
    expect(problems).toContain("row threads.setModel: scenarios stays empty in P1a")
  })
})

// Review 6061342489 M2 and M3: an expectation is a port operation, and the held table is checked as a contract.
describe("negative controls added by the first review", () => {
  const effect = (id: string, input: Record<string, unknown>, expectation: TableScenario["expect"]): TableScenario => ({
    id: `threads.setModel/${id}`,
    row: "threads.setModel",
    kind: "effect",
    input,
    expect: expectation,
  })

  test("#given an expectation naming an operation its port does not have #then the scenario check names it", () => {
    const broken = effect("bad-op", { thread: "a", model: "m" }, [{ port: "host", op: "teleport" }])
    expect(scenarioProblems(rows, contract, withScenario(scenarios, broken)).join("\n")).toContain(
      "host has no operation teleport",
    )
  })

  test("#given an expectation with a negative count #then the scenario check names it", () => {
    const broken = effect("bad-count", { thread: "a", model: "m" }, [{ port: "host", op: "set_model", count: -1 }])
    expect(scenarioProblems(rows, contract, withScenario(scenarios, broken)).join("\n")).toContain(
      "count is a whole number of calls",
    )
  })

  test("#given a behaviour input whose scenarios expect what the scenarios without it expect #then it names the input", () => {
    const same = [{ port: "host" as const, op: "set_model", args: { model: "m" } }]
    const files = scenarios.map((file) =>
      file.domain !== "threads"
        ? file
        : {
            ...file,
            scenarios: [
              ...file.scenarios.filter((scenario) => scenario.row !== "threads.setModel" || scenario.kind !== "effect"),
              effect("plain", { thread: "a", model: "m" }, same),
              effect("with-provider", { thread: "a", model: "m", provider: "p" }, same),
              effect("with-scope", { thread: "a", model: "m", all_scope: true }, [
                { port: "host", op: "set_model", args: { model: "m", all_scope: true } },
              ]),
              effect("with-key", { thread: "a", model: "m", idempotency_key: "k" }, [
                { port: "store", op: "idempotency_put", args: { key: "k" } },
              ]),
            ],
          },
    )
    expect(scenarioProblems(rows, contract, files).join("\n")).toContain(
      "row threads.setModel: input provider has no scenario pair that differs in provider alone",
    )
  })

  test("#given a held root entry that is not a root option #then the scope check names it", () => {
    const gated = [...contract.gated, { row: "root", field: "socketPath", s0: ["4.4"], reason: "x", rowExists: true }]
    expect(scopeProblems(rows, { ...contract, gated }).join("\n")).toContain(
      "socketPath is not a root option of design 4.1",
    )
  })

  test("#given a held entry with no section and no explicit reason for that #then the scope check names it", () => {
    const gated = [...contract.gated, { row: "threads.list", field: "workspace", s0: [], reason: "x", rowExists: true }]
    expect(scopeProblems(rows, { ...contract, gated }).join("\n")).toContain(
      "cites no section of the security design; say why in heldWithoutS0",
    )
  })

  test("#given a held entry citing a section the security design does not have #then the scope check names it", () => {
    const gated = [
      ...contract.gated,
      { row: "threads.list", field: "workspace", s0: ["9.9"], reason: "x", rowExists: true },
    ]
    expect(scopeProblems(rows, { ...contract, gated }).join("\n")).toContain("cites section 9.9")
  })
})

// Review 6061577043 M2: an input changes behaviour only when a scenario that differs from another in that input alone
// expects something else.
describe("negative controls added by the second review", () => {
  test("#given a field whose only partner also differs in another field #then the scenario check names the field", () => {
    const pair = (id: string, input: Record<string, unknown>, op: string): TableScenario => ({
      id: `threads.setModel/${id}`,
      row: "threads.setModel",
      kind: "effect",
      input,
      expect: [{ port: "host", op }],
    })
    const files = scenarios.map((file) =>
      file.domain !== "threads"
        ? file
        : {
            ...file,
            scenarios: [
              ...file.scenarios.filter((scenario) => scenario.row !== "threads.setModel"),
              pair("plain", { thread: "a", model: "m" }, "set_model"),
              pair("provider-and-scope", { thread: "a", model: "m", provider: "p", all_scope: true }, "set_model"),
              pair("scope", { thread: "a", model: "m", all_scope: true }, "set_model"),
              pair("key", { thread: "a", model: "m", idempotency_key: "k" }, "set_model"),
            ],
          },
    )
    expect(scenarioProblems(rows, contract, files).join("\n")).toContain(
      "row threads.setModel: input provider has no scenario pair that differs in provider alone",
    )
  })
})

// Review 6061836983: held codes carry a checked reason and enumerated values are each exercised. Fixtures, faults and
// address coverage are P0's checks over the one scenario shape in expectation.ts.
describe("negative controls added by the third review", () => {
  test("#given a held code whose reason names a row P1a types #then the code check names it", () => {
    const heldCodes = {
      ...contract.heldCodes,
      internal_error: { because: "held-rows" as const, rows: ["account.whoami"] },
    }
    const registry = Object.fromEntries(Object.entries(contract.registry).filter(([code]) => code !== "internal_error"))
    expect(codeProblems(rows, { ...contract, registry, heldCodes }, scenarios).join("\n")).toContain(
      "held code internal_error: names row account.whoami, which P1a types; register the code",
    )
  })

  test("#given an enumerated input value no scenario passes #then the scenario check names the value", () => {
    const files = scenarios.map((file) => ({
      ...file,
      scenarios: file.scenarios.filter(
        (scenario) => !(scenario.row === "engine.config.setResource" && scenario.input["state"] === "unload"),
      ),
    }))
    expect(scenarioProblems(rows, contract, files).join("\n")).toContain(
      'row engine.config.setResource: input state value "unload" is in no scenario',
    )
  })
})

describe("negative controls added with the design lane's ruling on release", () => {
  test("#given a refusal read from the answered value #then its engine code needs no registry entry, while a root refusal does", () => {
    const fromValue = {
      id: "threads.release/value-refusal",
      row: "threads.release",
      kind: "refusal" as const,
      refusal: "engine_specific_error",
      refusal_from: "value" as const,
      input: { thread: "t-1" },
      expect: [{ port: "host", op: "release_session", count: 0 }],
    }
    expect(codeProblems(rows, contract, withScenario(scenarios, fromValue)).join("\n")).not.toContain(
      "engine_specific_error",
    )
    const fromRoot = { ...fromValue, id: "threads.release/root-refusal", refusal_from: "root" as const }
    expect(codeProblems(rows, contract, withScenario(scenarios, fromRoot)).join("\n")).toContain(
      "code engine_specific_error: returned by threads and missing from the code registry",
    )
  })
})

describe("negative controls added by the fourth review", () => {
  test("#given a control verb with no scenario on an ended session #then the scenario check names the state", () => {
    const files = scenarios.map((file) => ({
      ...file,
      scenarios: file.scenarios.filter((scenario) => {
        const given = scenario.given ?? []
        return !(scenario.row === "threads.setModel" && given.some((entry) => entry.state["session"] === "ended"))
      }),
    }))
    expect(scenarioProblems(rows, contract, files).join("\n")).toContain(
      "row threads.setModel: no scenario on an ended session (given session: ended)",
    )
  })
})

describe("negative controls of the pair comparison's matcher semantics", () => {
  test("#given a pair whose expectations differ only in order and an explicit default count #then the input has no pair", () => {
    const pair = (
      id: string,
      input: Record<string, unknown>,
      expectations: TableScenario["expect"],
    ): TableScenario => ({
      id: `threads.setModel/${id}`,
      row: "threads.setModel",
      kind: "effect",
      input,
      expect: expectations,
    })
    const a = { port: "host", op: "set_model" }
    const b = { port: "store", op: "idempotency_put" }
    const files = scenarios.map((file) =>
      file.domain !== "threads"
        ? file
        : {
            ...file,
            scenarios: [
              ...file.scenarios.filter((scenario) => scenario.row !== "threads.setModel"),
              pair("plain", { thread: "a", model: "m" }, [a, b]),
              pair("provider", { thread: "a", model: "m", provider: "p" }, [{ ...b, count: 1 }, a]),
            ],
          },
    )
    expect(scenarioProblems(rows, contract, files).join("\n")).toContain(
      "row threads.setModel: input provider has no scenario pair that differs in provider alone",
    )
  })
})

describe("negative controls of the recovery retry's complete trace (review 6062548108)", () => {
  const step = scenarios
    .flatMap((file) => file.scenarios)
    .find((scenario) => scenario.id === "threads.create/recovery-admission-lost")?.then?.[0]
  const listing = { port: "remote", op: "sessions.list", args: { device: "studio" } }
  const send = { port: "remote", op: "sessions.send", args: { thread: "t-k8", message: "build it" } }

  test("#given the retry admits the first prompt once #then its stated effects match", () => {
    expect(expectationProblems(step?.expect ?? [], [listing, send])).toEqual([])
  })

  test("#given the retry admits the first prompt twice or not at all #then the stated effects refuse it", () => {
    expect(expectationProblems(step?.expect ?? [], [listing, send, send]).join("\n")).toContain(
      "expected 1 call(s), observed 2",
    )
    expect(expectationProblems(step?.expect ?? [], [listing]).join("\n")).toContain("expected 1 call(s), observed 0")
  })
})
