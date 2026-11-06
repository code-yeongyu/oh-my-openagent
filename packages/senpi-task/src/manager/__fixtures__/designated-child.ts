import { buildTaskExecute } from "../../tools/task/execute"
import { makeDeps } from "../../tools/task/__fixtures__/task-tool-fakes"
import { createTaskRecordStore } from "../../store"
import type { ResolvedModelRecord, TaskRecord } from "../../state"
import { createTaskManager } from "../manager"
import type { ResolvedChildPlan } from "../types"
import { settings, tempProject } from "./manager-fakes"
import { chainIds } from "./model-chain-ids"
import { createModelChainWorld, type ModelChainWorld, type RunnerKind, type Step } from "./model-chain-world"

// The parent session runs on a working, logged-in model of another provider. No child may ever call it.
export const PARENT = chainIds("in-process").parent

const rung = (display: string): ResolvedModelRecord => {
  const [provider = "", id = ""] = display.split("/")
  return { source: "category", provider, model_id: id, display }
}

function chainPlan(category: string, chain: readonly string[]): ResolvedChildPlan {
  const [head, ...rest] = chain.map(rung)
  if (head === undefined) throw new Error("empty chain")
  return { model: head.display, category, requested_model: head, resolved_model: head, fallback_models: rest }
}

export type DesignatedChildInput = {
  readonly category: string
  readonly chain: readonly string[]
  readonly scripts: Readonly<Record<string, readonly Step[]>>
  readonly runner?: RunnerKind
  readonly userFallbackChains?: Readonly<Record<string, readonly string[]>>
}

/**
 * A parent on PARENT_MODEL calls the real task tool for a category whose designated chain is `chain`,
 * and the child runs on the requested runner against the world's real engine until its record settles.
 * The world is handed back even when the start throws, so the caller always disposes it.
 */
export async function runCategoryChild(
  input: DesignatedChildInput,
  adopt: (world: ModelChainWorld) => void,
): Promise<{ readonly record: TaskRecord; readonly world: ModelChainWorld }> {
  const { records, world } = await runCategoryChildren([input], adopt)
  const [record] = records
  if (record === undefined) throw new Error("no child record")
  return { record, world }
}

/**
 * Every input is started in the background by one parent, on one runner, in one world, before any is
 * awaited, so they share one engine (one socket host for `host`). Categories must differ: each one plans
 * its own chain. Scripts and user chains are taken from the first input.
 */
export async function runCategoryChildren(
  inputs: readonly DesignatedChildInput[],
  adopt: (world: ModelChainWorld) => void,
): Promise<{ readonly records: readonly TaskRecord[]; readonly world: ModelChainWorld }> {
  const [first] = inputs
  if (first === undefined) throw new Error("no child to run")
  const chains = new Map(inputs.map((input) => [input.category, input.chain]))
  if (chains.size !== inputs.length) throw new Error("each child needs its own category")
  const world = await createModelChainWorld(first.scripts, {
    ...(first.userFallbackChains === undefined ? {} : { userFallbackChains: first.userFallbackChains }),
  })
  adopt(world)
  const project = tempProject()
  const inProcess = world.runner()
  const kind = first.runner ?? "in-process"
  const [parentProvider = "", parentId = ""] = chainIds(kind).parent.split("/")
  const manager = createTaskManager({
    store: createTaskRecordStore({ project_dir: project }),
    runners: { "in-process": inProcess, process: kind === "in-process" ? inProcess : await world.engineRunner(kind) },
    planner: (spec) => ({ kind: "resolved", plan: chainPlan(spec.category ?? "", chains.get(spec.category ?? "") ?? []) }),
    config: settings({ default_concurrency: inputs.length + 1, max_depth: 1 }),
    cwd: project,
    destruction: { destroyResidentTask: async () => {} },
  })
  try {
    const deps = makeDeps(manager)
    const task = settings({ default_execution_mode: kind === "in-process" ? "in-process" : "process" })
    const execute = buildTaskExecute({ ...deps, omoConfig: { ...deps.omoConfig, task } })
    const taskIds = await Promise.all(inputs.map(async (input, index) => {
      const result = await execute(`call-${index + 1}`, { prompt: "do the thing", category: input.category, run_in_background: true }, undefined, undefined, {
        cwd: project,
        sessionManager: { getSessionId: () => "parent-1" },
        model: { provider: parentProvider, id: parentId },
      })
      const taskId = result.details.task_id
      if (typeof taskId !== "string" || !taskId.startsWith("st_")) throw new Error(`child did not start: ${JSON.stringify(result.details)}`)
      return taskId
    }))
    return { records: await Promise.all(taskIds.map((taskId) => manager.waitFor(taskId))), world }
  } finally {
    manager.workpools.dispose()
  }
}
