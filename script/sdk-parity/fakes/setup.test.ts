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
import { createRecorder } from "./recorder"
import { FAKE_HOME_PREFIX, scenarioSetup } from "./setup"

// P1b's rows, and T1b's threads.send and threads.unload, judged as isBuilt will judge them once the rows list their scenarios: each row's `scenarios` filled
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
  "threads.send",
  "threads.unload",
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
// A `then` step's problem (`<id>#step2`) is its scenario's difference: an entry names the scenario.
const failing = (problems: readonly string[]): string[] =>
  [
    ...new Set(
      problems.flatMap((problem) => /scenario (\S+\/\S+?)(?::| )/.exec(problem)?.[1]?.replace(/#step\d+$/, "") ?? []),
    ),
  ].toSorted()
async function judged(changed: TableScenario): Promise<string[]> {
  const row = rows.find((candidate) => candidate.id === changed.row)
  if (row === undefined) throw new Error(`no row ${changed.row}`)
  const [record] = await runEffectScenarios(rows, [{ scenario: changed, setup: () => scenarioSetup(changed) }])
  return conformanceProblems([row], NONE, record === undefined ? [] : [record], CONTEXT).filter((problem) =>
    problem.includes(changed.id),
  )
}

describe("P1b scenario drivers over the real omo SDK root", () => {
  test("#given the three runs modules #then every table scenario of the run rows has exactly one run", () => {
    expect(RUNS.map((run) => run.scenario.id).toSorted()).toEqual(scenarios.map((s) => s.id).toSorted())
    expect(RUNS).toHaveLength(123)
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

describe("the fake store's receipt book reaches the root's answer (T1b)", () => {
  test("#given a keyed rename #when the key is repeated with other arguments, then with the same #then the root answers idempotency_conflict, then the first answer, and the host renamed once", async () => {
    const scenario = scenarioOf("threads.rename/name")
    const setup = scenarioSetup(scenario)
    const root = setup.root as { readonly threads: { readonly rename: (input: unknown) => Promise<unknown> } }
    const rename = (name: string) =>
      root.threads.rename({
        thread: "t-1",
        name,
        idempotency_key: "k-book",
      })
    const first = await rename("review")
    expect(await rename("other")).toMatchObject({ kind: "error", error: { code: "idempotency_conflict" } })
    expect(await rename("review")).toEqual(first)
    expect(setup.calls().filter((call) => call.op === "rename_session")).toHaveLength(1)
  })
})

describe("the root's extended send and create inputs over the fakes (T1b)", () => {
  type Threads = {
    readonly send: (input: unknown) => Promise<unknown>
    readonly create: (input: unknown) => Promise<unknown>
  }
  const tableScenario = (id: string): TableScenario => {
    const found = table.flatMap((file) => file.scenarios).find((scenario) => scenario.id === id)
    if (found === undefined) throw new Error(`no scenario ${id}`)
    return found
  }
  const rootOf = (id: string) => {
    const setup = scenarioSetup(tableScenario(id))
    return { threads: (setup.root as { readonly threads: Threads }).threads, ops: () => setup.calls().map((c) => c.op) }
  }

  test.each([
    ["a thread on this device", "t-1", { path: "/w/a.png" }],
    ["a thread on another device", "studio/t-2", { bytes: new Uint8Array([104, 105]), name: "a.txt" }],
  ] as const)(
    "#given attachments on a send to %s #then it is refused unsupported and nothing is read or delivered",
    async (_where, thread, attachment) => {
      const { threads, ops } = rootOf("threads.send/attachments")
      const answer = await threads.send({ thread, message: "status?", attachments: [attachment] })
      expect(answer).toMatchObject({
        kind: "error",
        error: { code: "unsupported", details: { field: "attachments", count: 1 } },
      })
      expect(ops()).toEqual([])
    },
  )

  test("#given a create with an object prompt and a key #when it is repeated #then one thread gets one delivery of that prompt", async () => {
    const { threads, ops } = rootOf("threads.create/prompt-object-plain")
    const input = { prompt: { message: "hello", delivery: "follow_up" }, idempotency_key: "k-first" }
    const first = await threads.create(input)
    expect(first).toMatchObject({ kind: "ok" })
    expect(await threads.create(input)).toEqual({ ...(first as object), deduplicated: true })
    expect(ops().filter((op) => op === "open_session")).toHaveLength(1)
    expect(ops().filter((op) => op === "insert_delivery")).toHaveLength(1)
    expect(ops().filter((op) => op === "follow_up")).toHaveLength(1)
  })

  test("#given an object prompt that names its turn #then the delivery carries it, and a repeat naming another turn conflicts", async () => {
    const setup = scenarioSetup(tableScenario("threads.create/prompt-object-plain"))
    const { threads } = setup.root as { readonly threads: Threads }
    const create = (turn: string) =>
      threads.create({
        prompt: { message: "hello", delivery: "follow_up", expected_turn_id: turn },
        idempotency_key: "k-turn",
      })
    expect(await create("3")).toMatchObject({ kind: "ok" })
    const inserted = setup.calls().filter((call) => call.op === "insert_delivery")
    expect(inserted.map((call) => call.args)).toEqual([expect.objectContaining({ expected_turn_id: "3" })])
    expect(await create("4")).toMatchObject({ kind: "error", error: { code: "idempotency_conflict" } })
  })

  test.each([
    ["summary", { summary: "hi" }, "not_implemented"],
    ["author", { author: { platform_user_id: "u-1", display: "Una" } }, "not_implemented"],
    ["attachments", { attachments: [{ path: "/w/a.png" }] }, "unsupported"],
  ] as const)(
    "#given an object prompt with %s #then the create answers %s and opens no thread",
    async (_field, extra, code) => {
      const { threads, ops } = rootOf("threads.create/prompt-object")
      const answer = await threads.create({ prompt: { message: "hello", ...extra } })
      expect(answer).toMatchObject({ kind: "error", error: { code } })
      expect(ops().filter((op) => op === "open_session")).toEqual([])
    },
  )

  test("#given the create's delivery and its prompt's delivery differ #then it is refused before any open", async () => {
    const { threads, ops } = rootOf("threads.create/prompt-object")
    const answer = await threads.create({ delivery: "steer", prompt: { message: "hello", delivery: "follow_up" } })
    expect(answer).toMatchObject({ kind: "error", error: { code: "invalid_arguments" } })
    expect(ops()).toEqual([])
  })
})
