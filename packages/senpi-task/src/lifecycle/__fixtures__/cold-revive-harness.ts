import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createTaskRecord, type TaskRecord } from "../../state"
import { createTaskRecordStore, type TaskRecordStore } from "../../store"
import { createTaskManager } from "../../manager/manager"
import { FakeRunner, makeHandle, settings, tempProject } from "../../manager/__fixtures__/manager-fakes"
import type { ManagedChildHandle } from "../../manager/child-handle"
import type { ManagedStartSpec } from "../../manager/types"
import { createTaskLifecycle } from "../create"
import type { ReviveDriftPolicy, ReviveGenerationWarning } from "../revive-policy"
import { createManagerResidencyRegistry } from "../../../../omo-senpi/src/components/task/residency-registry"
import { createConfigGenerationStampingStore } from "../../../../omo-senpi/src/components/task/config-generation-store"

export function coldReviveHarness(options: {
  readonly policy?: ReviveDriftPolicy
  readonly generation?: number
  readonly cap?: number
  readonly idleTimeoutMs?: number
  readonly now?: () => number
  readonly storeWrapper?: (store: TaskRecordStore) => TaskRecordStore
  readonly resume?: (spec: ManagedStartSpec, path: string, handle: ManagedChildHandle) => Promise<ManagedChildHandle>
} = {}) {
  const project = tempProject()
  const backing = createTaskRecordStore({ project_dir: project })
  const record: TaskRecord = {
    ...createTaskRecord({ parent_session_id: "parent", root_session_id: "parent", depth: 1, execution_mode: "in-process", model: "fixture/model", notify_on_terminal: false }),
    status: "completed", residency_state: "persisted_only", final_response: "TRANSCRIPT_SENTINEL",
    spawn_spec: { version: 1, cwd: project, prompt: "RECORDED_PROMPT", instructions: "RECORDED_INSTRUCTIONS", member_scoped_tool_names: ["fixture_read"] },
    tool_allow: ["read", "fixture_read"], tool_deny: ["write"], agent_type: "custom-worker",
    ...(options.generation === undefined ? {} : { config_generation: options.generation }),
  }
  backing.save(record)
  const stamped = createConfigGenerationStampingStore(backing, () => 2)
  const store = options.storeWrapper?.(stamped) ?? stamped
  const sessionDir = join(store.stateDir, "children", record.task_id, "sessions", record.task_id)
  mkdirSync(sessionDir, { recursive: true })
  const sessionPath = join(sessionDir, "fixture.jsonl")
  writeFileSync(sessionPath, '{"role":"assistant","content":"TRANSCRIPT_SENTINEL"}\n')
  const fake = makeHandle(record.task_id)
  const resumed: Array<{ spec: ManagedStartSpec; path: string }> = []
  const warnings: ReviveGenerationWarning[] = []
  const config = settings({ default_concurrency: 1, global_concurrency: 1, residency_max_children: options.cap ?? 4, ...(options.idleTimeoutMs === undefined ? {} : { resident_idle_timeout_ms: options.idleTimeoutMs }) })
  const manager = createTaskManager({ store, cwd: project, config, now: options.now,
    planner: () => ({ kind: "resolved", plan: { model: "fixture/model" } }),
    runners: { "in-process": { start: (spec) => new FakeRunner().start(spec), resume: async (spec, path) => {
      resumed.push({ spec, path })
      return options.resume === undefined ? fake.handle : options.resume(spec, path, fake.handle)
    } }, process: new FakeRunner() },
    destruction: { destroyResidentTask: (id, cause) => lifecycle.destroyResidentTask(id, cause) },
  })
  const registry = createManagerResidencyRegistry(() => manager)
  const lifecycle = createTaskLifecycle({ store, registry, config, now: options.now,
    revivePolicy: { currentGeneration: () => 2, warn: (warning) => warnings.push(warning), ...(options.policy === undefined ? {} : { policy: options.policy }) },
    idleReclaimerScheduler: { setInterval: () => ({}), clearInterval: () => undefined },
  })
  return { project, store, record, fake, manager, lifecycle, registry, resumed, warnings, sessionPath,
    send: (message = "CONTINUE_SENTINEL") => manager.sendToTask({ idOrName: record.task_id, callerSessionId: "parent", message }),
    dispose: async () => { lifecycle.dispose?.(); await lifecycle.destroyResidentTask(record.task_id, "cancel") },
  }
}
