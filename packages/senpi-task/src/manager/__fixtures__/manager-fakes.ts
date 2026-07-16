import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { OmoTaskSettingsSchema, type OmoTaskSettings } from "@oh-my-opencode/omo-config-core"

import type { RunnerOutcome } from "../../runners/in-process/child-handle"
import { createTaskRecordStore } from "../../store"
import type { ManagedChildHandle } from "../child-handle"
import { createTaskManager } from "../manager"
import type { AdmitResident, ChildPlanner, ManagedRunner, ManagedStartSpec, ManagerStartSpec } from "../types"

const cleanupRoots: string[] = []

export function cleanupProjects(): void {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
}

export function tempProject(): string {
  const directory = mkdtempSync(join(tmpdir(), "senpi-task-manager-"))
  cleanupRoots.push(directory)
  return directory
}

export function settings(overrides: Record<string, unknown> = {}): OmoTaskSettings {
  return OmoTaskSettingsSchema.parse(overrides)
}

export type FakeHandle = {
  readonly handle: ManagedChildHandle
  settle: (outcome: RunnerOutcome) => void
  readonly steerCalls: string[]
  readonly followUpCalls: string[]
}

export function makeHandle(taskId: string, pid?: number): FakeHandle {
  let resolveOutcome: (outcome: RunnerOutcome) => void = () => {}
  // Re-armable: each settle resolves the current cycle's promise and arms a fresh one for the next
  // tracking cycle, so a revived task (re-tracked under a new epoch) awaits its OWN completion.
  let outcome = new Promise<RunnerOutcome>((resolve) => {
    resolveOutcome = resolve
  })
  const steerCalls: string[] = []
  const followUpCalls: string[] = []
  const handle: ManagedChildHandle = {
    task_id: taskId,
    sessionId: `sess-${taskId}`,
    pid,
    steer: async (text) => {
      steerCalls.push(text)
    },
    followUp: async (text) => {
      followUpCalls.push(text)
    },
    abort: async () => {},
    subscribe: () => () => {},
    waitForOutcome: () => outcome,
    lastAssistantText: () => undefined,
    dispose: async () => {},
  }
  const settle = (value: RunnerOutcome): void => {
    const resolveCurrent = resolveOutcome
    outcome = new Promise<RunnerOutcome>((resolve) => {
      resolveOutcome = resolve
    })
    resolveCurrent(value)
  }
  return { handle, settle, steerCalls, followUpCalls }
}

export class FakeRunner implements ManagedRunner {
  readonly handles = new Map<string, FakeHandle>()
  throwOnStart = false
  startError: unknown = undefined
  readonly startedSpecs: ManagedStartSpec[] = []
  // When set, every handle this runner produces reports this pid (an rpc-style child with a real OS
  // process). Left undefined it mimics an in-process child with no pid.
  childPid: number | undefined = undefined

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    this.startedSpecs.push(spec)
    if (this.startError !== undefined) throw this.startError
    if (this.throwOnStart) throw new Error("runner boom")
    const fake = makeHandle(spec.taskId, this.childPid)
    this.handles.set(spec.taskId, fake)
    return Promise.resolve(fake.handle)
  }
}

export function categoryPlanner(models: Record<string, string> = {}): ChildPlanner {
  return (spec: ManagerStartSpec) => {
    const key = spec.category ?? spec.subagent_type ?? "default"
    const model = spec.model ?? models[key] ?? "anthropic/claude"
    return {
      kind: "resolved",
      plan: {
        model,
        ...(spec.category !== undefined ? { category: spec.category } : {}),
        ...(spec.subagent_type !== undefined ? { agentType: spec.subagent_type } : {}),
      },
    }
  }
}

export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export function makeManager(options: {
  project?: string
  config?: OmoTaskSettings
  planner?: ChildPlanner
  inProcess?: FakeRunner
  process?: FakeRunner
  admit?: AdmitResident
} = {}) {
  const project = options.project ?? tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  const inProcess = options.inProcess ?? new FakeRunner()
  const processRunner = options.process ?? new FakeRunner()
  const manager = createTaskManager({
    store,
    runners: { "in-process": inProcess, process: processRunner },
    planner: options.planner ?? categoryPlanner(),
    config: options.config ?? settings({ default_concurrency: 5, max_depth: 1 }),
    cwd: project,
    ...(options.admit !== undefined && { admit: options.admit }),
  })
  return { manager, store, inProcess, process: processRunner, project }
}

export function baseSpec(overrides: Partial<ManagerStartSpec> = {}): ManagerStartSpec {
  return {
    prompt: "do the thing",
    parent_session_id: "parent-1",
    depth: 1,
    category: "quick",
    ...overrides,
  }
}
