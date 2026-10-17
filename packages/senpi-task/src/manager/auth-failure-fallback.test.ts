import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"

import type { ResolvedModelRecord } from "../state"
import type { ResolvedChildPlan } from "./types"
import { FakeRunner, baseSpec, cleanupProjects, makeManager, settings } from "./__fixtures__/manager-fakes"

// Real provider answers captured on 2026-09-26: an OpenCode Go key whose subscription lapsed, and an
// Anthropic OAuth login whose refresh token the provider rejects.
const SUBSCRIPTION_REQUIRED =
  '403: {"type":"server_error","message":"Upstream request failed: An active OpenCode Go subscription is required to use Go models."}'
const REFRESH_REJECTED =
  'OAuth refresh failed for anthropic: Anthropic token refresh request failed. status=400; body={"error": "invalid_grant", "error_description": "Refresh token not found or invalid"}'

function rung(provider: string, modelId: string): ResolvedModelRecord {
  return { source: "category", provider, model_id: modelId, display: `${provider}/${modelId}` }
}

const GO_M3 = rung("opencode-go", "minimax-m3")
const GO_M27 = rung("opencode-go", "minimax-m2.7")
const ZAI_GLM = rung("zai", "glm-5.3")
const OPUS = rung("anthropic", "claude-opus-5-5")
const OPUS_5 = rung("anthropic", "claude-opus-5")

function chainPlan(primary: ResolvedModelRecord, fallbacks: readonly ResolvedModelRecord[]): ResolvedChildPlan {
  return { model: primary.display, requested_model: primary, resolved_model: primary, fallback_models: [...fallbacks] }
}

async function failTurn(runner: FakeRunner, taskId: string, message: string): Promise<void> {
  const handle = runner.handles.get(taskId)
  if (handle === undefined) throw new Error("expected a running child")
  const unsubscribed = handle.waitForUnsubscription()
  handle.settle({ status: "error", failure: { kind: "child-turn-failed", message } })
  await unsubscribed
}

function harness(plan: ResolvedChildPlan) {
  const runner = new FakeRunner()
  const { manager, store } = makeManager({
    inProcess: runner,
    planner: () => ({ kind: "resolved", plan }),
    config: settings({ default_concurrency: 2, max_depth: 1 }),
  })
  return { runner, manager, store }
}

afterEach(cleanupProjects)

describe("runtime fallback after a credential failure", () => {
  test("#given a failure that is not about credentials and no rung left #when the child turn fails #then the error text is kept as is", async () => {
    const { runner, manager } = harness(chainPlan(GO_M3, []))
    const task = await manager.start(baseSpec())
    if (task.kind !== "started") throw new Error("expected started")

    const terminal = manager.waitFor(task.task_id)
    runner.handles.get(task.task_id)?.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })

    expect((await terminal).error_message).toBe("500: upstream overloaded")
  })

  test("#given a provider error that is not about credentials #when the child turn fails #then the next rung on the same provider is still tried", async () => {
    const { runner, manager, store } = harness(chainPlan(GO_M3, [GO_M27, ZAI_GLM]))
    const task = await manager.start(baseSpec())
    if (task.kind !== "started") throw new Error("expected started")

    await failTurn(runner, task.task_id, "500: upstream overloaded")

    expect(runner.startedSpecs.map((spec) => spec.model)).toEqual([GO_M3.display, GO_M27.display])
    expect(store.load(task.task_id)).toMatchObject({ model: GO_M27.display, fallback_models: [ZAI_GLM] })
  })

  test("#given a lapsed subscription (403) on the first rung #when the child turn fails #then every remaining rung on that provider is skipped and the next provider runs", async () => {
    const { runner, manager, store } = harness(chainPlan(GO_M3, [GO_M27, ZAI_GLM]))
    const task = await manager.start(baseSpec())
    if (task.kind !== "started") throw new Error("expected started")

    await failTurn(runner, task.task_id, SUBSCRIPTION_REQUIRED)

    expect(runner.startedSpecs.map((spec) => spec.model)).toEqual([GO_M3.display, ZAI_GLM.display])
    expect(store.load(task.task_id)).toMatchObject({ model: ZAI_GLM.display, fallback_models: [] })
    const events = readFileSync(join(store.stateDir, "logs", `${task.task_id}.jsonl`), "utf8")
    expect(events).toContain('"type":"task_model_fallback"')
    expect(events).toContain(`"to_model":"${ZAI_GLM.display}"`)
    expect(events).toContain(`"skipped_models":["${GO_M27.display}"]`)
  })

  test("#given a rejected OAuth refresh and only same-provider rungs left #when the child turn fails #then no rung is relaunched and the task ends in error", async () => {
    const { runner, manager, store } = harness(chainPlan(OPUS, [OPUS_5]))
    const task = await manager.start(baseSpec())
    if (task.kind !== "started") throw new Error("expected started")

    const terminal = manager.waitFor(task.task_id)
    const handle = runner.handles.get(task.task_id)
    if (handle === undefined) throw new Error("expected a running child")
    handle.settle({ status: "error", failure: { kind: "child-turn-failed", message: REFRESH_REJECTED } })

    const ended = await terminal
    expect(ended.status).toBe("error")
    expect(ended.error_message).toStartWith(REFRESH_REJECTED)
    expect(ended.error_message).toContain("re-authenticate anthropic")
    expect(ended.error_message).toContain("Provider authentication settings")
    expect(ended.error_message).toContain("/login anthropic")
    expect(runner.startedSpecs.map((spec) => spec.model)).toEqual([OPUS.display])
    expect(store.load(task.task_id)?.status).toBe("error")
  })
})
