import { afterEach, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import type { ManagedChildHandle } from "./child-handle"
import { FakeRunner, baseSpec, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"
import { SECRET_CELLS } from "./__fixtures__/secret-inventory"
import type { ManagedStartSpec } from "./types"

afterEach(cleanupProjects)

class ObservableRunner extends FakeRunner {
  readonly #startWaiters: Array<(spec: ManagedStartSpec) => void> = []

  override start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const result = super.start(spec)
    this.#startWaiters.shift()?.(spec)
    return result
  }

  nextStart(): Promise<ManagedStartSpec> {
    return new Promise((resolve) => {
      this.#startWaiters.push(resolve)
    })
  }
}

const PARENT = "vendor-p/parent-model"

function planner() {
  return () => ({
    kind: "resolved" as const,
    plan: {
      model: "vendor-a/primary-model",
      requested_model: { source: "category" as const, provider: "vendor-a", model_id: "primary-model", display: "vendor-a/primary-model" },
      resolved_model: { source: "category" as const, provider: "vendor-a", model_id: "primary-model", display: "vendor-a/primary-model" },
      fallback_models: [],
      category: "quick",
    },
  })
}

function filesText(dir: string): string {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile())
    .map((path) => readFileSync(path, "utf8"))
    .join("\n")
}

const failedTurn = (errorMessage: string) => ({
  type: "message_end",
  message: { role: "assistant", stopReason: "error", content: [], errorMessage },
}) as const

// Every task-store place provider text can reach: the record (error_message, parent_model_fallback.detail and every
// other field) and every file under the task state dir (the event log and the transcript log included).
describe("provider error text never reaches the task store raw (#11355)", () => {
  for (const cell of SECRET_CELLS) {
    test(`#given ${cell.name} in a usage limit and then a model-not-found answer #when the task hops to the parent's model and ends #then no record field or log holds the secret`, async () => {
      // given
      const runner = new ObservableRunner()
      const { manager, store } = makeManager({ planner: planner(), inProcess: runner })
      const initialStart = runner.nextStart()
      const result = await manager.start(baseSpec({ execution_mode: "in-process", category: "quick", parent_model: PARENT }))
      if (result.kind !== "started") throw new Error("expected started task")
      await initialStart
      const first = runner.handles.get(result.task_id)
      if (first === undefined) throw new Error("expected initial handle")
      await first.waitForSubscription()
      const limit = `${cell.text} \u00b7 You've hit your session limit`
      const fallbackStart = runner.nextStart()

      // when
      first.emit(failedTurn(limit))
      first.settle({ status: "error", failure: { kind: "child-turn-failed", message: limit } })
      await fallbackStart
      const second = runner.handles.get(result.task_id)
      if (second === undefined) throw new Error("expected parent-model handle")
      await second.waitForSubscription()
      const terminal = manager.waitFor(result.task_id)
      const notServed = `${cell.text}\n404 {"code":"model_not_found","message":"unknown provider for model parent-model"}`
      second.emit(failedTurn(notServed))
      second.settle({ status: "error", failure: { kind: "child-turn-failed", message: notServed } })
      const record = await terminal

      // then
      expect(record.parent_model_fallback).toMatchObject({ reason: "usage_limit" })
      expect(record.parent_model_fallback?.detail).toContain("[REDACTED]")
      expect(record.error_message).toContain("[REDACTED]")
      const sinks = { record: JSON.stringify(store.load(result.task_id)), state: filesText(store.stateDir) }
      for (const [sink, text] of Object.entries(sinks)) {
        expect({ sink, leaked: text.includes(cell.secret) }).toEqual({ sink, leaked: false })
      }
    })
  }

  // The child-observed hop: the child's own engine falls back onto the parent's model (observeParentModelFallback
  // writes parent_model_fallback.detail), then reports an exhausted chain whose last_error reaches the event log.
  for (const cell of SECRET_CELLS) {
    test(`#given ${cell.name} in a failed turn the child itself falls back from #when the chain is exhausted #then no record field or log holds the secret`, async () => {
      // given
      const runner = new ObservableRunner()
      const { manager, store } = makeManager({ planner: planner(), inProcess: runner })
      const initialStart = runner.nextStart()
      const result = await manager.start(baseSpec({ execution_mode: "in-process", category: "quick", parent_model: PARENT }))
      if (result.kind !== "started") throw new Error("expected started task")
      await initialStart
      const handle = runner.handles.get(result.task_id)
      if (handle === undefined) throw new Error("expected initial handle")
      await handle.waitForSubscription()
      const limit = `${cell.text} \u00b7 You've hit your session limit`
      const applied = { type: "retry_fallback_applied", from: "vendor-a/primary-model", to: PARENT, chainKey: "vendor-a/primary-model", reason: "billing" } as const
      const exhausted = { type: "retry_fallback_exhausted", chainKey: "vendor-a/primary-model", lastError: `503 overloaded ${cell.text}` } as const
      const terminal = manager.waitFor(result.task_id)

      // when
      handle.emit(failedTurn(limit))
      handle.emit(applied)
      handle.emit(exhausted)
      handle.settle({ status: "error", failure: { kind: "child-turn-failed", message: `503 overloaded ${cell.text}` } })
      const record = await terminal

      // then
      expect(record.parent_model_fallback).toMatchObject({ reason: "usage_limit" })
      expect(record.parent_model_fallback?.detail).toContain("[REDACTED]")
      const events = readFileSync(join(store.stateDir, "logs", `${result.task_id}.jsonl`), "utf8")
      expect(events).toContain('"type":"retry_fallback_exhausted"')
      const sinks = { record: JSON.stringify(store.load(result.task_id)), state: filesText(store.stateDir) }
      for (const [sink, text] of Object.entries(sinks)) {
        expect({ sink, leaked: text.includes(cell.secret) }).toEqual({ sink, leaked: false })
      }
    })
  }
})
