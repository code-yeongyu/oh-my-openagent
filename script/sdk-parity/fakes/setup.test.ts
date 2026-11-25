import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PORT_EFFECTS } from "../../../packages/omo-senpi/src/components/omo-sdk/contract/ports"
import { type ConformanceContext, conformanceProblems, type EffectEvidence } from "../conformance"
import { runEffectScenarios, type ScenarioRun } from "../conformance-run"
import { expectationProblems, type TableScenario } from "../expectation"
import { type Baseline, UNRESOLVED_PATH } from "../baseline"
import { allRows, loadDomainFiles, REPO_ROOT } from "../registry"
import { runs as configRuns } from "../runs/config"
import { runs as deviceRuns } from "../runs/devices"
import { runs as threadRuns } from "../runs/threads"
import { loadScenarioTable } from "../scenario-table"
import { fsPort, processPort } from "./process-fs"
import type { ThreadHost } from "../../../packages/omo-senpi/src/components/thread/tools/ports"
import { createRecorder } from "./recorder"
import { FAKE_HOME_PREFIX, scenarioSetup } from "./setup"

// P1b's eight rows judged as isBuilt will judge them once the rows list their scenarios: each row's `scenarios` filled
// from the table, the real effect classification (PORT_EFFECTS) and the table's inert fields. Every scenario the real
// root answers differently from the table is an entry of the closed record scenario-differences.json, checked both
// ways: a difference with no entry fails, and an entry whose scenario now passes fails as stale.
type Difference = {
  readonly id: string
  readonly differs: string
  readonly owner: string
  readonly retires_with: string
}
const DIFFERENCES = (
  JSON.parse(readFileSync(join(import.meta.dir, "..", "scenario-differences.json"), "utf8")) as {
    readonly entries: readonly Difference[]
  }
).entries
const UNRESOLVED = new Set(
  (JSON.parse(readFileSync(join(REPO_ROOT, UNRESOLVED_PATH), "utf8")) as Baseline).entries.map((entry) => entry.id),
)

const ROWS = [
  "devices.list",
  "devices.rename",
  "threads.extensions.call",
  "threads.extensions.register",
  "threads.locate",
  "threads.release",
  "threads.rename",
  "threads.setModel",
  "config.status",
]
const table = loadScenarioTable()
const scenarios = table.flatMap((file) => file.scenarios).filter((scenario) => ROWS.includes(scenario.row))
const rows = allRows(loadDomainFiles())
  .filter((row) => ROWS.includes(row.id))
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
const NONE = new Set<string>()
const RUNS: readonly ScenarioRun[] = [...deviceRuns, ...threadRuns, ...configRuns]

const leftovers = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith(FAKE_HOME_PREFIX))
afterEach(() => {
  expect(leftovers()).toEqual([])
})

let evidence: EffectEvidence[] = []
beforeAll(async () => {
  evidence = await runEffectScenarios(rows, RUNS)
}, 120_000)

const scenarioOf = (id: string): TableScenario => {
  const found = scenarios.find((scenario) => scenario.id === id)
  if (found === undefined) throw new Error(`no scenario ${id}`)
  return found
}
const failing = (problems: readonly string[]): string[] =>
  [...new Set(problems.flatMap((problem) => /scenario (\S+\/\S+?)(?::| )/.exec(problem)?.[1] ?? []))].toSorted()
async function judged(changed: TableScenario): Promise<string[]> {
  const row = rows.find((candidate) => candidate.id === changed.row)
  if (row === undefined) throw new Error(`no row ${changed.row}`)
  const [record] = await runEffectScenarios(rows, [{ scenario: changed, setup: () => scenarioSetup(changed) }])
  return conformanceProblems([row], NONE, record === undefined ? [] : [record], CONTEXT).filter((problem) =>
    problem.includes(changed.id),
  )
}

describe("P1b scenario drivers over the real omo SDK root", () => {
  test("#given the three runs modules #then every table scenario of the driven rows has exactly one run", () => {
    expect(RUNS.map((run) => run.scenario.id).toSorted()).toEqual(scenarios.map((s) => s.id).toSorted())
    expect(RUNS).toHaveLength(92)
  })

  test("#given the differences record #then it is sorted, complete per entry, and names only rows still unresolved", () => {
    const ids = DIFFERENCES.map((entry) => entry.id)
    expect(ids).toEqual([...new Set(ids)].toSorted())
    for (const entry of DIFFERENCES) {
      expect(Object.keys(entry).toSorted()).toEqual(["differs", "id", "owner", "retires_with"])
      expect([entry.differs, entry.owner, entry.retires_with].every((field) => field.trim() !== "")).toBe(true)
      expect(UNRESOLVED.has(scenarioOf(entry.id).row)).toBe(true)
    }
  })

  test("#given every run's record #then a difference with no entry and an entry that now passes both fail", () => {
    const problems = conformanceProblems(rows, NONE, evidence, CONTEXT)
    const differing = failing(problems)
    const recorded = DIFFERENCES.map((entry) => entry.id)
    expect({
      undocumented: differing.filter((id) => !recorded.includes(id)),
      stale: recorded.filter((id) => !differing.includes(id)),
    }).toEqual({ undocumented: [], stale: [] })
    const differingRows = new Set(recorded.map((id) => scenarioOf(id).row))
    for (const row of rows.filter((candidate) => !differingRows.has(candidate.id)))
      expect(conformanceProblems([row], NONE, evidence, CONTEXT)).toEqual([])
    const rowLevel = problems.filter((problem) => !/ scenario \S+\//.test(problem))
    for (const problem of rowLevel)
      expect([...differingRows].some((row) => problem.startsWith(`row ${row}`))).toBe(true)
  })

  test("#given a refusal scenario #then its record names the code and where it was read", () => {
    const of = (id: string) => evidence.find((record) => record.scenario === id)
    expect(of("devices.list/signed-out")).toMatchObject({ code: "signed_out", codeSource: "root" })
    expect(of("threads.rename/device-offline")).toMatchObject({ code: "device_offline", codeSource: "root" })
    expect(of("threads.release/on-other-device")).toMatchObject({
      code: "unsupported",
      codeSource: "root",
      answered: { error: { details: { reason: "release_unsupported" } } },
    })
    expect(of("threads.extensions.register/extension-refuses-session")?.code).toBe("sender_not_allowed")
  })
})

describe("negative controls: a wrong expectation is reported for each fake family", () => {
  const wrong = (id: string, index: number, change: Record<string, unknown>): TableScenario => {
    const scenario = scenarioOf(id)
    return { ...scenario, expect: scenario.expect.map((e, at) => (at === index ? { ...e, ...change } : e)) }
  }

  test.each([
    ["host", "threads.release/plain", 0, { args: { thread: "t-1", reason: "other" } }],
    ["store", "threads.extensions.call/call", 0, { args: { name: "other" } }],
    ["session", "devices.rename/renames-and-reads-back", 0, { args: { id: "dev-9", name: "studio" } }],
    ["credentialStore", "devices.list/lists-live-devices", 0, { count: 0 }],
    ["remote", "threads.rename/on-other-device", 0, { args: { thread: "studio/t-2", name: "other" } }],
  ] as const)(
    "#given %s expected wrongly #when %s runs #then the call is reported",
    async (_port, id, index, change) => {
      expect(await judged(scenarioOf(id))).toEqual([])
      expect((await judged(wrong(id, index, change))).length).toBeGreaterThan(0)
    },
  )

  // #14939: the outcome a model switch answers is the core's classification, so a root whose classifier answers the wrong
  // outcome must fail exactly the scenarios that state one: after_compaction and applied swapped, partial_commit answered
  // as not_applied.
  const misclassified = (answer: unknown): unknown => {
    const ok = answer as { kind?: string; model_switch?: string; error?: { code?: string } }
    if (ok.kind === "ok" && ok.model_switch === "after_compaction") return { ...ok, model_switch: "applied" }
    if (ok.kind === "ok" && ok.model_switch === "applied") return { ...ok, model_switch: "after_compaction" }
    if (ok.kind === "error" && ok.error?.code === "partial_commit")
      return { ...ok, error: { ...ok.error, code: "not_applied" } }
    return answer
  }
  const withSetModel = (root: unknown, map: (answer: unknown) => unknown): unknown =>
    new Proxy(Object(root), {
      get: (target, key) => {
        const value = Reflect.get(target, key) as unknown
        if (key !== "threads") return value
        return new Proxy(Object(value), {
          get: (threads, member) => {
            const call = Reflect.get(threads, member) as unknown
            if (member !== "setModel" || typeof call !== "function") return call
            return async (...args: unknown[]) => map(await Reflect.apply(call, threads, args))
          },
        })
      },
    })
  test("#given a root whose classifier answers the wrong outcome #when every threads.setModel scenario runs #then exactly the scenarios that state an outcome fail", async () => {
    const setModel = scenarios.filter((scenario) => scenario.row === "threads.setModel")
    const runs: ScenarioRun[] = setModel.map((scenario) => ({
      scenario,
      setup: () => {
        const real = scenarioSetup(scenario)
        return { ...real, root: withSetModel(real.root, misclassified) }
      },
    }))
    const row = rows.find((candidate) => candidate.id === "threads.setModel")
    if (row === undefined) throw new Error("no threads.setModel row")
    const wrong = failing(conformanceProblems([row], NONE, await runEffectScenarios(rows, runs), CONTEXT))
    const states = (answer: Readonly<Record<string, unknown>> | undefined): boolean =>
      answer !== undefined && "model_switch" in answer
    // Each call that states an outcome fails on its own: the scenario, and a later step as `<id>#step<n>`.
    const stating = setModel
      .flatMap((scenario) => [
        ...(scenario.refusal === "partial_commit" || states(scenario.answer) ? [scenario.id] : []),
        ...(scenario.then ?? []).flatMap((step, index) =>
          states(step.answer) ? [`${scenario.id}#step${index + 2}`] : [],
        ),
      ])
      .toSorted()
    expect(stating.length).toBeGreaterThan(0)
    expect(wrong).toEqual(stating)
  })

  test("#given threads.setModel/idempotent-repeat #when the adapter drops the effect id before the holder #then the scenario fails", async () => {
    const scenario = scenarioOf("threads.setModel/idempotent-repeat")
    const dropEffect = (host: ThreadHost): ThreadHost => {
      const strip =
        (port: ThreadHost): ThreadHost["setModel"] =>
        (session, provider, id, durable) =>
          port.setModel(session, provider, id, durable)
      return {
        ...host,
        setModel: strip(host),
        ...(host.endpoint === undefined
          ? {}
          : { endpoint: (socket: string) => ({ ...host.endpoint?.(socket), setModel: strip(host) }) }),
      } as ThreadHost
    }
    expect(await judged(scenario)).toEqual([])
    const [record] = await runEffectScenarios(rows, [
      { scenario, setup: () => scenarioSetup(scenario, { wrapHost: dropEffect }) },
    ])
    const row = rows.find((candidate) => candidate.id === scenario.row)
    if (row === undefined || record === undefined) throw new Error("no record")
    expect(
      conformanceProblems([row], NONE, [record], CONTEXT).filter((problem) => problem.includes(scenario.id)).length,
    ).toBeGreaterThan(0)
  })

  test("#given two stated results for one operation #when it is called three times #then each answers in turn and the last repeats", () => {
    const recorder = createRecorder({
      ...scenarioOf("threads.setModel/applied-here-suffix"),
      expect: [
        { port: "host", op: "get_state", result: { model: "openai/m-0" } },
        { port: "host", op: "get_state", result: { model: "anthropic/m-1" } },
      ],
    })
    const read = () => recorder.record("host", "get_state", { thread: "t-1" }).result
    expect([read(), read(), read()]).toEqual([
      { model: "openai/m-0" },
      { model: "anthropic/m-1" },
      { model: "anthropic/m-1" },
    ])
  })

  test("#given process and fs calls #when expected wrongly #then expectationProblems reports them", async () => {
    const recorder = createRecorder(scenarioOf("config.status/reads-config-files"))
    await fsPort(recorder, { home: "/h", agentDir: "/h/.omo/agent" }).read("/h/.omo/omo.jsonc")
    await processPort(recorder).signal(42, "SIGTERM")
    expect(recorder.calls()).toEqual([
      { port: "fs", op: "read", args: { path: "~/.omo/omo.jsonc" } },
      { port: "process", op: "signal", args: { pid: 42, signal: "SIGTERM" } },
    ])
    const right = [
      { port: "fs", op: "read", args: { path: "~/.omo/omo.jsonc" } },
      { port: "process", op: "signal", args: { pid: 42 } },
    ]
    expect(expectationProblems(right, recorder.calls())).toEqual([])
    expect(
      expectationProblems([{ port: "fs", op: "read", args: { path: "/agent/x" } }], recorder.calls()),
    ).toHaveLength(1)
    expect(expectationProblems([{ port: "process", op: "signal", args: { pid: 7 } }], recorder.calls())).toHaveLength(1)
  })
})

describe("the workspace scope is pinned by the scope scenarios' answers", () => {
  const withoutAllScope = (id: string): TableScenario => {
    const { all_scope: _dropped, ...input } = scenarioOf(id).input
    return { ...scenarioOf(id), input }
  }
  const movedElsewhere = (id: string): TableScenario => ({
    ...scenarioOf(id),
    given: [{ port: "host", state: { thread: "t-1", workspace: "elsewhere" } }],
  })

  test.each([
    ["threads.locate/all-scope", "all_scope dropped", withoutAllScope],
    ["threads.rename/all-scope", "all_scope dropped", withoutAllScope],
    ["threads.locate/here", "its thread moved out of the caller's workspace", movedElsewhere],
  ] as const)("#given %s #when %s #then it no longer passes", async (id, _how, broken) => {
    expect(await judged(scenarioOf(id))).toEqual([])
    expect((await judged(broken(id))).length).toBeGreaterThan(0)
  })
})
