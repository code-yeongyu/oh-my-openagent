import type { ConformanceContext } from "./conformance"
import type { ScenarioRun } from "./conformance-run"
import type { ObservedCall, TableScenario } from "./expectation"
import { rows, unresolved } from "./gate-fixture"
import type { Row } from "./schema"

// The shared fixture of the conformance controls: threads.locate counted as built, a fake host whose listSessions read
// is observed, and a context classifying the host's operations (listSessions a read, kill and spawn effects).

export const CONTEXT: ConformanceContext = { effects: { host: ["kill", "spawn"] } }

const locate = rows.find((row) => row.id === "threads.locate")
if (locate === undefined) throw new Error("no threads.locate row")
export const built: Row = {
  ...locate,
  today: "yes",
  scenarios: {
    effect: ["threads.locate/by-id", "threads.locate/all-scope", "threads.locate/other-device"],
    refusal: [],
  },
}
export const builtRows = rows.map((row) => (row.id === "threads.locate" ? built : row))
export const open = new Set(unresolved.entries.map((entry) => entry.id).filter((id) => id !== "threads.locate"))

export const scenario = (
  id: string,
  scopeAll: boolean | undefined,
  target: "this_device" | "other_device" = "this_device",
): TableScenario => ({
  id: `threads.locate/${id}`,
  row: "threads.locate",
  kind: "effect",
  target,
  input: scopeAll === undefined ? { thread: "t1" } : { thread: "t1", all_scope: scopeAll },
  expect: [{ port: "host", op: "listSessions", args: { allScope: scopeAll === true } }],
})
// A fake host whose listSessions call is observed; the SDK member under test forwards its input to it.
export const run = (
  table: TableScenario,
  answer: unknown = { kind: "ok" },
  member = (calls: ObservedCall[], input: unknown) => {
    calls.push({
      port: "host",
      op: "listSessions",
      args: { allScope: Reflect.get(Object(input), "all_scope") === true, limit: 50 },
    })
    return answer
  },
): ScenarioRun => ({
  scenario: table,
  setup: () => {
    const calls: ObservedCall[] = []
    return { root: { threads: { locate: (input: unknown) => member(calls, input) } }, calls: () => calls }
  },
})
export const pair = [
  run(scenario("by-id", undefined)),
  run(scenario("all-scope", true)),
  run(scenario("other-device", undefined, "other_device")),
]
