import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"
import { createCompletionNotifier, createEvalHandleHost, createTaskManager, createTaskRecordStore, type ManagedChildHandle, type ManagedRunner, type ParentNotifierMessage, type TaskManager } from "@oh-my-opencode/senpi-task"
import type { EvalHandleHost } from "@code-yeongyu/senpi"

import type { SenpiExtensionAPI } from "../../extension/types"
import { createCompletionObservingStore } from "./completion-bridge"
import { registerEvalHandleHost, type EvalHandleEngine } from "./eval-handle-host"

function fakePi(provide?: (host: EvalHandleHost) => void): SenpiExtensionAPI {
  return {
    on: () => undefined,
    registerTool: () => undefined,
    registerCommand: () => undefined,
    registerFlag: () => undefined,
    getFlag: () => undefined,
    sendMessage: () => undefined,
    sendUserMessage: () => undefined,
    ...(provide === undefined ? {} : { provideEvalHandleHost: provide }),
  }
}

const unused = (): never => { throw new Error("not reached by registration") }
const engine: EvalHandleEngine = {
  manager: { get: () => undefined, waitFor: unused, cancelTask: unused, sendToTask: unused, workpools: { inspect: unused, cancel: unused, subscribe: () => () => undefined } },
  stateDir: "/state",
  resolveAncestry: () => undefined,
  runtime: { cwd: () => "/project" },
}

describe("eval handle host registration", () => {
  test("a runtime with the capability slot receives a version 1 host for this session's tasks", () => {
    const provided: EvalHandleHost[] = []

    registerEvalHandleHost(fakePi((host) => provided.push(host)), engine)

    expect(provided.map((host) => host.version)).toEqual([1])
  })

  test("a runtime without the slot gets no host, so its eval cells report wait as unavailable", () => {
    const pi = fakePi()

    registerEvalHandleHost(pi, engine)

    expect(pi.provideEvalHandleHost).toBeUndefined()
  })
})

const projects: string[] = []
afterEach(() => {
  for (const project of projects.splice(0)) rmSync(project, { recursive: true, force: true })
})

function settleableRunner(): { readonly runner: ManagedRunner; readonly complete: (finalResponse: string) => void } {
  let finish: (outcome: { readonly status: "completed"; readonly finalResponse: string }) => void = () => undefined
  const outcome = new Promise<{ readonly status: "completed"; readonly finalResponse: string }>((resolve) => { finish = resolve })
  const runner: ManagedRunner = {
    start: (spec): Promise<ManagedChildHandle> => Promise.resolve({
      task_id: spec.taskId,
      sessionId: `session-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: () => () => {},
      waitForOutcome: () => outcome,
      lastAssistantText: () => undefined,
      dispose: () => Promise.resolve(),
    }),
  }
  return { runner, complete: (finalResponse) => finish({ status: "completed", finalResponse }) }
}

describe("eval handle host beside completion notifications", () => {
  test("a background task watched from a cell still notifies its parent exactly once, and the watch sees the end once", async () => {
    const project = mkdtempSync(join(tmpdir(), "omo-senpi-eval-handle-notify-"))
    projects.push(project)
    const backing = createTaskRecordStore({ project_dir: project })
    const messages: ParentNotifierMessage[] = []
    const completion = createCompletionNotifier({ notifier: { enqueue: (message) => messages.push(message) }, store: backing })
    let managerRef: TaskManager | undefined
    const store = createCompletionObservingStore(backing, { notifier: completion, parentState: () => ({ kind: "idle" }), wasBackground: (taskId) => managerRef?.wasBackground(taskId) ?? false })
    const { runner, complete } = settleableRunner()
    const manager = createTaskManager({ store, runners: { "in-process": runner, process: runner }, planner: () => ({ kind: "resolved", plan: { model: "anthropic/claude" } }), config: OmoTaskSettingsSchema.parse({ default_concurrency: 5, max_depth: 1 }), cwd: backing.stateDir })
    managerRef = manager
    const host = createEvalHandleHost({ tasks: manager, workpools: { inspect: unused, cancel: unused, subscribe: () => () => undefined }, poolCaller: (sessionId) => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: project }), stateDir: backing.stateDir })
    const started = await manager.start({ prompt: "work", parent_session_id: "parent-session", depth: 1, category: "quick", run_in_background: true })
    if (started.kind !== "started") throw new Error("expected a started task")
    const ref = { kind: "agent" as const, id: started.task_id, run_epoch: 0 }
    const owner = { ownerSessionId: "parent-session" }
    const watch = await host.watch([ref], owner)
    const seen: string[] = []
    const drained = (async () => { for await (const snapshot of watch.updates) seen.push(snapshot.phase) })()

    const terminal = manager.waitFor(started.task_id, { signal: AbortSignal.timeout(5000) })
    complete("done")
    await terminal
    watch.close()
    await drained
    const second = await host.watch([ref], owner)
    second.close()

    expect(seen).toEqual(["succeeded"])
    expect(messages.flatMap((message) => message.details.map((detail) => detail.task_id))).toEqual([started.task_id])
    expect(second.initial.map((snapshot) => snapshot.phase)).toEqual(["succeeded"])
  })
})
