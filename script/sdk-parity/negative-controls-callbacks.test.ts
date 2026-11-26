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
import { scenarioShapeProblems } from "./scenario-check"
import type { Row } from "./schema"

// Controls of the two scenario forms the design lane ruled for slice C1c (#14960): a callback's ordered calls
// (`callbacks`, complete both ways, each pinned to the effects the trace held when it was called) and a refusal's
// details (`refusal_details`, a subset match, its reason one of the code's closed set).

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
const rowOf = (id: string): Row => {
  const row = rows.find((candidate) => candidate.id === id)
  if (row === undefined) throw new Error(`no row ${id}`)
  return row
}
const shape = (table: TableScenario): string =>
  scenarioShapeProblems(table, rowOf(table.row), table.row.split(".")[0] ?? "", contract).join("\n")

const problems = async (runs: readonly ScenarioRun[], target: readonly Row[] = builtRows): Promise<string> =>
  conformanceProblems(target, open, await runEffectScenarios(target, runs), CONTEXT).join("\n")
const byIdRefused: readonly Row[] = builtRows.map((row) =>
  row.id === "threads.locate"
    ? {
        ...row,
        scenarios: {
          effect: row.scenarios.effect.filter((id) => id !== "threads.locate/by-id"),
          refusal: [...row.scenarios.refusal, "threads.locate/by-id"],
        },
      }
    : row,
)
const host = (op: string): ObservedCall => ({ port: "host", op, args: {} })

// threads.locate's by-id scenario, given a "$callback" input the member below calls.
const asking = (callbacks: TableScenario["callbacks"]): TableScenario => ({
  ...scenario("by-id", undefined),
  input: { ...scenario("by-id", undefined).input, decide: "$callback" },
  expect: [
    { port: "host", op: "listSessions" },
    { port: "host", op: "kill" },
  ],
  ...(callbacks === undefined ? {} : { callbacks }),
})
// Asks `decide` about each stage in turn; the second ask comes after one effect (host.kill).
const member =
  (stages: readonly string[]) =>
  async (calls: ObservedCall[], input: unknown): Promise<unknown> => {
    calls.push(host("listSessions"))
    const decide = Reflect.get(Object(input), "decide") as (stage: { id: string }) => unknown
    for (const [index, id] of stages.entries()) {
      if (index === 1) calls.push(host("kill"))
      await decide({ id })
    }
    if (stages.length < 2) calls.push(host("kill"))
    return { kind: "ok" }
  }

describe("callbacks: complete both ways, each call pinned to the effects before it", () => {
  const entries = [
    { when: { id: "credentials" }, answer: "apply", effects_before: 0 },
    { when: { id: "assets" }, answer: "skip", effects_before: 1 },
  ]

  test("#given every call consumes its entry in order after the stated effects #then no callback problem", async () => {
    expect(
      await problems([
        run(asking({ decide: entries }), undefined, member(["credentials", "assets"])),
        ...pair.slice(1),
      ]),
    ).not.toContain("callback")
  })

  test("#given a call no remaining entry matches #then it fails", async () => {
    expect(
      await problems([
        run(asking({ decide: entries }), undefined, member(["credentials", "providers"])),
        ...pair.slice(1),
      ]),
    ).toContain('callback decide was called with {"id":"providers"}, which no remaining entry matches')
  })

  test("#given an entry never called #then it fails", async () => {
    expect(
      await problems([run(asking({ decide: entries }), undefined, member(["credentials"])), ...pair.slice(1)]),
    ).toContain("callback decide entry 1 was never called")
  })

  test("#given a call after a different number of effects than stated #then it fails", async () => {
    const early = [entries[0], { ...entries[1], effects_before: 0 }] as typeof entries
    expect(
      await problems([run(asking({ decide: early }), undefined, member(["credentials", "assets"])), ...pair.slice(1)]),
    ).toContain("callback decide entry 1 was called after 1 effect(s), not 0")
  })

  test("#given callbacks naming an input that is not a $callback #then the table check names it", () => {
    expect(shape({ ...asking({ other: entries }) })).toContain('callbacks.other names no "$callback" input')
  })

  test("#given an entry with a fractional effect count #then the table check names it", () => {
    expect(shape(asking({ decide: [{ when: {}, effects_before: 0.5 }] }))).toContain(
      "callbacks.decide[0].effects_before is a whole number of effects",
    )
  })
})

describe("refusal_details: a subset of the failure's details, its reason from the code's closed set", () => {
  const refusing = (details: Record<string, unknown>): TableScenario => ({
    ...scenario("by-id", undefined),
    kind: "refusal",
    refusal: "not_found",
    refusal_details: details,
  })
  const answering = (details: Record<string, unknown>) => async (calls: ObservedCall[]) => {
    calls.push(host("listSessions"))
    return { kind: "error", error: { code: "not_found", message: "m", next_action: "n", details } }
  }

  test("#given details that hold the stated subset #then no details problem", async () => {
    expect(
      await problems([
        run(refusing({ reason: "gone" }), undefined, answering({ reason: "gone", extra: 1 })),
        ...pair.slice(1),
      ]),
    ).not.toContain("refused with details")
  })

  test("#given details that differ from the stated subset #then it fails", async () => {
    expect(
      await problems(
        [run(refusing({ reason: "gone" }), undefined, answering({ reason: "moved" })), ...pair.slice(1)],
        byIdRefused,
      ),
    ).toContain('refused with details {"reason":"moved"}, not the stated {"reason":"gone"}')
  })

  test("#given refusal_details on an effect scenario #then the table check names it", () => {
    expect(shape({ ...scenario("by-id", undefined), refusal_details: { reason: "x" } })).toContain(
      "refusal_details belongs to a refusal",
    )
  })

  test("#given an install_failed reason outside its closed set #then the table check names the set", () => {
    const table: TableScenario = {
      id: "install.update/control-unknown-reason",
      row: "install.update",
      kind: "refusal",
      refusal: "install_failed",
      refusal_details: { reason: "locked" },
      input: {},
      expect: [{ port: "process", op: "spawn", count: 0 }],
    }
    expect(shape(table)).toContain("refusal_details.reason must be one of install_failed's reasons (engine_missing")
  })
})

describe("pending callbacks and call_options: the call waits, and its deadline reaches it", () => {
  test("#given a pending entry that also states an answer #then the table check names it", () => {
    expect(shape(asking({ decide: [{ when: {}, answer: "apply", effects_before: 0, pending: true }] }))).toContain(
      "callbacks.decide[0] never answers, so it states no answer",
    )
  })

  test("#given a fractional deadline_ms #then the table check names it", () => {
    expect(shape({ ...scenario("by-id", undefined), call_options: { deadline_ms: 1.5 } })).toContain(
      "call_options.deadline_ms is a whole number of milliseconds",
    )
  })

  test("#given call_options and a pending callback #then the member gets deadline_ms beside its signal, and the clock hears it is blocked", async () => {
    const seen: unknown[] = []
    let blocked = 0
    const table: TableScenario = {
      ...asking({ decide: [{ when: { id: "credentials" }, pending: true, effects_before: 0 }] }),
      call_options: { deadline_ms: 50 },
    }
    const waiting = async (calls: ObservedCall[], input: unknown, options?: unknown): Promise<unknown> => {
      seen.push(options)
      calls.push(host("listSessions"))
      const decide = Reflect.get(Object(input), "decide") as (stage: { id: string }) => Promise<unknown>
      void decide({ id: "credentials" })
      return { kind: "ok" }
    }
    const calls: ObservedCall[] = []
    await runEffectScenarios(builtRows, [
      {
        scenario: table,
        setup: () => ({
          root: { threads: { locate: (input: unknown, options: unknown) => waiting(calls, input, options) } },
          calls: () => calls,
          blocked: () => {
            blocked += 1
          },
        }),
      },
    ])
    expect(seen).toEqual([expect.objectContaining({ deadline_ms: 50 })])
    expect(blocked).toBe(1)
  })
})
