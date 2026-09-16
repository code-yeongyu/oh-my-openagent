import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { createTaskLifecycle } from "../../packages/senpi-task/src/lifecycle"
import { createTaskManager } from "../../packages/senpi-task/src/manager/manager"
import { TaskConcurrency } from "../../packages/senpi-task/src/manager/concurrency"
import { createInProcessManagedRunner } from "../../packages/senpi-task/src/manager/runner"
import { InProcessRunner } from "../../packages/senpi-task/src/runners/in-process"
import { loadSenpiBarrel } from "../../packages/senpi-task/src/lazy/senpi-barrel"
import { createTaskRecordStore } from "../../packages/senpi-task/src/store"
import type { ResidencyRegistry } from "../../packages/senpi-task/src/lifecycle/port"

const HOME = process.env.MEASURE_HOME ?? process.env.HOME ?? ""
const HOME_AUTH = join(HOME, ".omo/agent/auth.json")
const HOME_MODELS = join(HOME, ".omo/agent/models.json")

export async function openMeasureEnv() {
  const { ModelRegistry, ModelRuntime, createAgentSession } = await loadSenpiBarrel()
  const root = mkdtempSync(join(tmpdir(), "omp-item2-measure-"))
  const agentDir = join(root, "agent")
  mkdirSync(agentDir)
  const auth = JSON.parse(readFileSync(HOME_AUTH, "utf8")) as { readonly xai?: unknown }
  const models = JSON.parse(readFileSync(HOME_MODELS, "utf8")) as { readonly providers: { readonly xai: unknown } }
  writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ xai: auth.xai }))
  writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { xai: models.providers.xai } }))
  const runtime = ModelRuntime.createSync({
    agentDir,
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
    allowModelNetwork: true,
    refreshOnCreate: false,
  })
  const authStorage = (runtime as unknown as { readonly credentials: { readonly store: { get(id: string): unknown } } }).credentials.store
  if (authStorage.get("xai") == null) throw new Error("xai auth was not loaded from the isolated agent dir")
  const registry = new ModelRegistry(runtime, authStorage as never)
  const model = registry.find("xai", "grok-4.6")
  if (model === undefined || model === null) throw new Error("xai/grok-4.6 is not registered in the isolated agent dir")
  const store = createTaskRecordStore({ project_dir: root })
  const config = OmoTaskSettingsSchema.parse({ default_concurrency: 2, global_concurrency: 2, residency_max_children: 2, default_execution_mode: "in-process" })
  const concurrency = new TaskConcurrency(config)
  const runner = createInProcessManagedRunner(new InProcessRunner({
    createSession: async options => (await createAgentSession(options)).session,
  }), () => ({ agentDir, modelRuntime: runtime, modelRegistry: registry, authStorage: registry.authStorage, model }))
  const registryPort: ResidencyRegistry = {
    get: taskId => {
      const child = manager.getResidentHandle(taskId)
      return child === undefined ? undefined : { task_id: taskId, kind: "in-process", pid: undefined, abort: () => child.abort(), dispose: () => child.dispose(), terminate: async () => undefined }
    },
    entries: () => manager.residentTaskIds().flatMap(id => { const child = registryPort.get(id); return child === undefined ? [] : [child] }),
    forget: taskId => manager.forget(taskId), hasPendingSends: taskId => manager.hasPendingSends?.(taskId) ?? false,
    tryClaimEviction: taskId => manager.tryClaimEviction?.(taskId) ?? false,
    releaseEviction: taskId => manager.releaseEviction?.(taskId),
  }
  const lifecycle = createTaskLifecycle({ store, registry: registryPort, config })
  const manager = createTaskManager({
    store, concurrency, config, cwd: root,
    runners: { "in-process": runner, process: runner },
    planner: spec => ({ kind: "resolved", plan: { model: spec.model ?? "xai/grok-4.6" } }),
    destruction: lifecycle,
    admit: async parent => {
      const result = await lifecycle.admitResident(parent)
      return result.kind === "rejected" ? { kind: "rejected", message: result.error.message } : result
    },
  })
  const caller = { sessionId: "measure-parent", rootSessionId: "measure-root", depth: 0, cwd: root }
  return { root, agentDir, store, manager, lifecycle, caller, concurrency, modelId: "grok-4.6", provider: "xai" }
}
