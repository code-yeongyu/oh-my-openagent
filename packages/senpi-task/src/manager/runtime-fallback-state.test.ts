import { afterEach, expect, test } from "bun:test"

import { baseSpec, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"
import type { ManagedChildEvent } from "./child-handle"

afterEach(cleanupProjects)

function setup() {
  return makeManager({
    planner: () => ({
      kind: "resolved",
      plan: {
        model: "vendor/primary",
        resolved_model: { source: "category", provider: "vendor", model_id: "primary", display: "vendor/primary", reasoning_effort: "low" },
        fallback_models: [{ source: "category", provider: "vendor", model_id: "fallback", display: "vendor/fallback", reasoning_effort: "max" }],
      },
    }),
  })
}

function admitted(thinkingLevel: unknown, id = "fallback") {
  return { type: "model_changed", source: "fallback", model: { provider: "vendor", id }, thinkingLevel }
}

const bareReceipt = { type: "retry_fallback_applied", to: "vendor/fallback" }

test.each([
  { name: "applied high, not configured max", events: [admitted("high"), bareReceipt], effort: "high" },
  { name: "explicitly disabled reasoning", events: [admitted("off"), bareReceipt], effort: "off" },
  { name: "applied max", events: [admitted("max"), bareReceipt], effort: "max" },
  { name: "unknown effective level", events: [admitted("unsupported"), bareReceipt], effort: undefined },
  { name: "missing effective level", events: [admitted(undefined), bareReceipt], effort: undefined },
  { name: "legacy bare event without state", events: [bareReceipt], effort: undefined },
  { name: "legacy suffixed selector", events: [{ ...bareReceipt, to: "vendor/fallback:xhigh" }], effort: "xhigh" },
  { name: "pre-admission thinking signal", events: [{ type: "thinking_level_changed", level: "high" }, bareReceipt], effort: undefined },
  { name: "rejected model admission", events: [{ ...admitted("high"), type: "model_change_rejected" }, bareReceipt], effort: undefined },
  { name: "unrelated model change source", events: [{ ...admitted("high"), source: "manual" }, bareReceipt], effort: undefined },
  { name: "malformed model state", events: [{ ...admitted("high"), model: null }, bareReceipt], effort: undefined },
  { name: "different model's previous effort", events: [admitted("high", "other"), bareReceipt], effort: undefined },
  { name: "same model's replaced effort", events: [admitted("high"), admitted("off"), bareReceipt], effort: "off" },
  { name: "same model's unavailable new effort", events: [admitted("high"), admitted(undefined), bareReceipt], effort: undefined },
] satisfies readonly { readonly name: string; readonly events: readonly (ManagedChildEvent & Record<string, unknown>)[]; readonly effort: string | undefined }[])(
  "#given $name #when fallback events arrive #then only actual effort is persisted",
  async ({ events, effort }) => {
    // given
    const { manager, inProcess } = setup()
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error(`Unexpected start: ${started.kind}`)
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("Child missing")

    // when
    for (const event of events) fake.emit(event)
    fake.settle({ status: "completed", finalResponse: "done" })
    const record = await manager.waitFor(started.task_id)

    // then
    expect(record.resolved_model?.display).toBe("vendor/fallback")
    expect(record.resolved_model?.reasoning_effort).toBe(effort)
    expect(record.resolved_model?.reasoning).toBe(effort)
    expect(record.resolved_model?.variant).toBeUndefined()
    expect(record.fallback_models).toEqual([])
  },
)

test("#given a completed fallback task #when its replacement falls back #then task IDs retain independent actual efforts", async () => {
  // given
  const { manager, inProcess } = setup()
  const first = await manager.start(baseSpec())
  if (first.kind !== "started") throw new Error(`Unexpected start: ${first.kind}`)
  const previous = inProcess.handles.get(first.task_id)
  if (previous === undefined) throw new Error("First child missing")
  previous.emit(admitted("high"))
  previous.emit(bareReceipt)
  previous.settle({ status: "completed", finalResponse: "first result" })
  await manager.waitFor(first.task_id)
  manager.forget(first.task_id)
  const replacement = await manager.start(baseSpec())
  if (replacement.kind !== "started") throw new Error(`Unexpected start: ${replacement.kind}`)
  const current = inProcess.handles.get(replacement.task_id)
  if (current === undefined) throw new Error("Replacement child missing")

  // when
  previous.emit(admitted("max"))
  current.emit(admitted("off"))
  current.emit(bareReceipt)
  current.settle({ status: "completed", finalResponse: "replacement result" })
  const finished = await manager.waitFor(replacement.task_id)

  // then
  expect(replacement.task_id).not.toBe(first.task_id)
  expect(manager.get(first.task_id)?.resolved_model?.reasoning_effort).toBe("high")
  expect(finished.resolved_model?.reasoning_effort).toBe("off")
})
