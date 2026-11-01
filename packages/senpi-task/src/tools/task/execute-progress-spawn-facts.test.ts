import { describe, expect, test } from "bun:test"
import type { AgentToolResult } from "@code-yeongyu/senpi"

import type { ManagedChildListener, StartResult } from "../../manager"
import type { EffectiveModelRecord, ResolvedModelRecord, TaskRecord } from "../../state"
import type { TaskToolDetails } from "./types"
import { CTX, createFakeManager, makeDeps, makeRecord } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

type Deferred<T> = { readonly promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void }

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  return { promise: new Promise<T>((done, fail) => { resolve = done; reject = fail }), resolve, reject }
}

// Bounded wait on a signal: GREEN resolves through the event, RED fails with a named reason.
function withinBudget<T>(promise: Promise<T>, reason: string, budgetMs = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(reason)), budgetMs)
  })
  return Promise.race([promise, deadline]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}

function latestDetails(updates: readonly AgentToolResult<TaskToolDetails>[]): TaskToolDetails {
  const latest = updates.at(-1)
  if (latest === undefined) throw new Error("no progress partial was published")
  return latest.details
}

const TASK_ID = "st_spawn_facts_1"
const PLANNED: ResolvedModelRecord = { provider: "anthropic", model_id: "claude-plan", display: "anthropic/claude-plan", source: "category" }
// A start-time chain fallback moved the route (and the epoch) after the start report went out.
const FALLBACK: ResolvedModelRecord = { provider: "anthropic", model_id: "claude-fallback", display: "anthropic/claude-fallback", source: "category" }
const EFFECTIVE: EffectiveModelRecord = { ...FALLBACK, source: "fallback" }

type ExecuteParams = Parameters<ReturnType<typeof buildTaskExecute>>[1]

type SpawnFacts = { readonly run_epoch?: number; readonly resolved_model?: ResolvedModelRecord; readonly effective_model?: EffectiveModelRecord }

type Row = {
  readonly name: string
  readonly params: ExecuteParams
  readonly started: StartResult
  readonly facts: (details: TaskToolDetails) => SpawnFacts
  readonly expected: SpawnFacts
}

const singleFacts = (details: TaskToolDetails): SpawnFacts => ({
  run_epoch: details.run_epoch,
  resolved_model: details.resolved_model,
  effective_model: details.effective_model,
})

const ROWS: readonly Row[] = [
  {
    name: "a foreground spawn whose launch outlived the start-report window",
    params: { prompt: "inspect", category: "quick" },
    started: { kind: "started", task_id: TASK_ID, status: "running", name: "child", run_epoch: 1, resolved_model: PLANNED, starting: true },
    facts: singleFacts,
    expected: { run_epoch: 2, resolved_model: FALLBACK, effective_model: EFFECTIVE },
  },
  {
    name: "a foreground spawn queued for a slot and launched later",
    params: { prompt: "inspect", category: "quick" },
    started: { kind: "started", task_id: TASK_ID, status: "pending", name: "child", run_epoch: 1, resolved_model: PLANNED, queue_position: 1 },
    facts: singleFacts,
    expected: { run_epoch: 2, resolved_model: FALLBACK, effective_model: EFFECTIVE },
  },
  {
    name: "a foreground batch item whose launch outlived the start-report window",
    params: { category: "quick", tasks: [{ prompt: "inspect" }, { prompt: "review" }] },
    started: { kind: "started", task_id: TASK_ID, status: "running", name: "child", run_epoch: 1, resolved_model: PLANNED, starting: true },
    facts: (details) => ({ run_epoch: details.items?.[0]?.run_epoch, resolved_model: details.items?.[0]?.resolved_model }),
    expected: { run_epoch: 2, resolved_model: FALLBACK },
  },
]

describe("progress partials carry the spawn facts once the launch settles, however late", () => {
  for (const row of ROWS) {
    test(`#given ${row.name} #when the launch settles after the start report #then later partials carry the launched spawn facts`, async () => {
      // given: the record holds the plan until the launch settles, then the launched facts
      const planned = makeRecord({ task_id: TASK_ID, status: "running", resolved_model: PLANNED })
      let current: TaskRecord = { ...planned, notification: { ...planned.notification, run_epoch: 1 } }
      const launch = deferred<void>()
      const completion = deferred<TaskRecord>()
      const subscribed = deferred<void>()
      let listener: ManagedChildListener | undefined
      const taskIds = [TASK_ID, "st_spawn_facts_2"]
      let starts = 0
      const manager = createFakeManager({
        start: async () => ({ ...row.started, task_id: taskIds[starts++] ?? "st_spawn_facts_extra" }),
        whenLaunched: () => launch.promise,
        get: (taskId) => taskId === TASK_ID ? current : undefined,
        subscribeChild: (_taskId, next) => {
          listener = next
          subscribed.resolve()
          return () => {}
        },
        waitFor: () => completion.promise,
      })
      const updates: AgentToolResult<TaskToolDetails>[] = []
      const published = deferred<void>()
      const execution = buildTaskExecute(makeDeps(manager))("spawn-facts", row.params, undefined, (update) => {
        updates.push(update)
        if (row.facts(update.details).run_epoch === row.expected.run_epoch) published.resolve()
      }, CTX)
      try {
        await withinBudget(subscribed.promise, "the foreground spawn never subscribed to its child")
        // A child may publish progress before runner.start has returned its model facts.
        if (row.started.kind === "started" && row.started.starting === true) {
          listener?.({ type: "tool_execution_start", toolName: "read", args: { path: "src/early.ts" } })
          expect(updates).toHaveLength(0)
        } else {
          expect(row.facts(latestDetails(updates)).effective_model).toBeUndefined()
        }

        // when: the launch settles after the start report went out
        current = { ...current, notification: { ...current.notification, run_epoch: 2 }, resolved_model: FALLBACK, effective_model: EFFECTIVE }
        launch.resolve()
        if (row.started.kind === "started" && row.started.starting === true) {
          await withinBudget(published.promise, "no partial carried the launched spawn facts after the launch settled")
          expect(row.facts(latestDetails(updates))).toEqual(row.expected)
        }
        listener?.({ type: "tool_execution_start", toolName: "read", args: { path: "src/foo.ts" } })

        // then
        expect(row.facts(latestDetails(updates))).toEqual(row.expected)
      } finally {
        launch.resolve()
        completion.resolve({ ...current, status: "completed", final_response: "done" })
        await execution
      }
    })
  }
})

const REJECTING_ROWS: readonly { readonly name: string; readonly params: ExecuteParams }[] = [
  { name: "a foreground spawn", params: { prompt: "inspect", category: "quick" } },
  { name: "a foreground batch", params: { category: "quick", tasks: [{ prompt: "inspect" }, { prompt: "review" }] } },
]

// whenLaunched is optional on the manager contract and does not promise never to reject.
describe("a rejected launch releases the held progress partials", () => {
  for (const row of REJECTING_ROWS) {
    test(`#given ${row.name} whose launch rejects #when a child event was held #then partials resume and no rejection escapes`, async () => {
      // given
      const record = makeRecord({ task_id: TASK_ID, status: "running", resolved_model: PLANNED })
      const launch = deferred<void>()
      const completion = deferred<TaskRecord>()
      const subscribed = deferred<void>()
      const published = deferred<void>()
      const escaped: unknown[] = []
      const onUnhandled = (reason: unknown): void => { escaped.push(reason) }
      process.on("unhandledRejection", onUnhandled)
      let listener: ManagedChildListener | undefined
      const taskIds = [TASK_ID, "st_spawn_facts_2"]
      let starts = 0
      const manager = createFakeManager({
        start: async () => ({ kind: "started", task_id: taskIds[starts++] ?? "st_spawn_facts_extra", status: "running", name: "child", run_epoch: 1, resolved_model: PLANNED, starting: true }),
        whenLaunched: () => launch.promise,
        get: (taskId) => taskId === TASK_ID ? record : undefined,
        subscribeChild: (_taskId, next) => {
          listener = next
          subscribed.resolve()
          return () => {}
        },
        waitFor: () => completion.promise,
      })
      const updates: AgentToolResult<TaskToolDetails>[] = []
      const execution = buildTaskExecute(makeDeps(manager))("spawn-facts-rejected", row.params, undefined, (update) => {
        updates.push(update)
        published.resolve()
      }, CTX)
      try {
        await withinBudget(subscribed.promise, "the foreground spawn never subscribed to its child")
        listener?.({ type: "tool_execution_start", toolName: "read", args: { path: "src/early.ts" } })
        expect(updates).toHaveLength(0)

        // when
        launch.reject(new Error("launch failed"))
        await withinBudget(published.promise, "the held partials stayed frozen after the launch rejected")
        // Let the runtime's rejection tracking run before reading what escaped.
        await new Promise<void>((done) => setImmediate(done))

        // then
        expect(updates.length).toBeGreaterThan(0)
        expect(escaped).toEqual([])
      } finally {
        completion.resolve({ ...record, status: "completed", final_response: "done" })
        await execution
        process.off("unhandledRejection", onUnhandled)
      }
    })
  }
})
