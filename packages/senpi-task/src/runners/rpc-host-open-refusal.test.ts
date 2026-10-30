import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { launchSettled } from "../manager/__fixtures__/manager-fakes"
import type { ChildPlanner, StartResult } from "../manager/types"
import type { ResolvedModelRecord } from "../state"
import type { FakeHostOpenFailure } from "./rpc-host/__fixtures__/fake-host"
import { HOST_CHILD_MODEL, startHostWorld, type HostWorld, type ParentSession } from "./rpc-host/__fixtures__/host-world"

/**
 * omo#10879: the host refuses `open_session` with `open_failed` for many reasons. A refusal that names
 * the REQUESTED MODEL as the cause (its window misses the start minimum, or the host cannot resolve it)
 * means another model may serve, so the start walks the category chain; every other refusal would
 * repeat on the next model and must end the start as a session refusal.
 */

const FIRST: ResolvedModelRecord = {
  provider: "anthropic",
  model_id: "claude-haiku-5-5",
  display: "anthropic/claude-haiku-5-5",
  source: "category",
}

const NEXT: ResolvedModelRecord = {
  provider: "anthropic",
  model_id: "claude-sonnet-4-5",
  display: HOST_CHILD_MODEL,
  source: "category",
}

const chainPlanner: ChildPlanner = () => ({
  kind: "resolved",
  plan: { model: FIRST.display, resolved_model: FIRST, category: "unspecified-high", fallback_models: [NEXT] },
})

// The engine's own wording for a start-minimum refusal (senpi ModelUsabilityBudgetError), as the host
// relays it inside `open_failed: <reason>`.
const BUDGET_DETAIL = `Model "${FIRST.display}" cannot start: context window 100000 tokens is 611 tokens short of the 100611-token minimum (system prompt 21000, active tool schemas 39000, output reserve 32000, compaction reserve 6611, speculation lead 0, safety margin 2000 [default]).`

const worlds: HostWorld[] = []

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.cleanup()
})

async function startOnChain(refusal: FakeHostOpenFailure) {
  const world = await startHostWorld()
  worlds.push(world)
  const parent = world.connect("parent-10879", { planner: chainPlanner })
  world.host.failOpen({ ...refusal, modelId: FIRST.model_id })
  const result = await parent.manager.start({ prompt: "work", parent_session_id: parent.sessionId, depth: 1, execution_mode: "process" })
  await launchSettled(parent.manager, result)
  const openedModels = world.host.commands
    .filter((command) => command.type === "open_session")
    .map((command) => command.payload.modelId)
  return { world, parent, result, openedModels }
}

function taskIdOf(result: StartResult): string {
  if (!("task_id" in result) || typeof result.task_id !== "string") throw new Error(`expected a task id, got ${JSON.stringify(result)}`)
  return result.task_id
}

function eventLog(parent: ParentSession, taskId: string): readonly Record<string, unknown>[] {
  return readFileSync(join(parent.store.stateDir, "logs", `${taskId}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("an open_failed refusal that names the requested model walks the chain (#10879)", () => {
  test("#given the host refuses the first model because its window misses the start minimum #when the task starts #then it runs on the next model and the fallback names the shortfall", async () => {
    // given / when
    const { parent, result, openedModels } = await startOnChain({ code: "open_failed", detail: BUDGET_DETAIL })

    // then
    const taskId = taskIdOf(result)
    expect(openedModels).toEqual([FIRST.model_id, NEXT.model_id])
    expect(parent.store.load(taskId)).toMatchObject({ status: "running", model: NEXT.display })
    const fallback = eventLog(parent, taskId).find((event) => event.type === "task_model_fallback")
    expect(fallback?.payload).toMatchObject({
      from_model: FIRST.display,
      to_model: NEXT.display,
      failure_kind: "model_unavailable",
      failure_reason: "model_context_too_small",
      context_window: 100_000,
      start_minimum: 100_611,
      shortfall: 611,
    })
  })

  test("#given the host cannot resolve the first model #when the task starts #then it runs on the next model", async () => {
    // given / when: senpi's open-session-model refusal carries its reason in errorData
    const { parent, result, openedModels } = await startOnChain({
      code: "open_failed",
      detail: `model_unavailable: Model "${FIRST.display}" was not found`,
      data: { reason: "model_unavailable", requestedModel: FIRST.display },
    })

    // then
    expect(openedModels).toEqual([FIRST.model_id, NEXT.model_id])
    expect(parent.store.load(taskIdOf(result))).toMatchObject({ status: "running", model: NEXT.display })
  })

  test("#given the host refuses the first model for a reason unrelated to the model #when the task starts #then the start fails as a session refusal without trying the next model", async () => {
    // given / when
    const { parent, result, openedModels } = await startOnChain({ code: "open_failed", detail: "the session store is unavailable" })

    // then
    expect(openedModels).toEqual([FIRST.model_id])
    expect(parent.store.load(taskIdOf(result))).toMatchObject({
      status: "error",
      model: FIRST.display,
      failure_kind: "session_unavailable",
      failure_reason: "open_failed",
    })
  })
})
