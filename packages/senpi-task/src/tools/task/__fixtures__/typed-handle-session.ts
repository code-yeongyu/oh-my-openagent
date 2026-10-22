import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { loadSenpiBarrel } from "../../../lazy/senpi-barrel"

import { createTaskManager } from "../../../manager/manager"
import { adaptInProcessHandle } from "../../../manager/child-handle"
import type { ManagedChildHandle, ManagedRunner } from "../../../manager"
import { launchSettled, settings, tempProject } from "../../../manager/__fixtures__/manager-fakes"
import { InProcessRunner } from "../../../runners/in-process"
import { createTaskRecordStore } from "../../../store"
import { buildTaskExecute } from "../execute"
import { makeDeps } from "./task-tool-fakes"

// Restored real sessions are deterministic: no prompt, provider, or model network call is made.
export async function realSessionHandle(deferRestoreUntilReported = false) {
  const { ModelRuntime, SessionManager, createAgentSession } = await loadSenpiBarrel()
  const project = tempProject()
  const agentDir = join(project, "isolated-agent")
  mkdirSync(agentDir)
  const store = createTaskRecordStore({ project_dir: project })
  const handles: ManagedChildHandle[] = []
  const transcripts: Array<{ path: string; before: string }> = []
  const restoreAllowed = Promise.withResolvers<void>()
  if (!deferRestoreUntilReported) restoreAllowed.resolve()
  const runner = new InProcessRunner({ createSession: async (options) => {
    await restoreAllowed.promise
    const { session } = await createAgentSession({
      ...options,
      modelRuntime: ModelRuntime.createSync({ agentDir, allowModelNetwork: false, refreshOnCreate: false }),
    })
    return session
  } })
  const restoredRunner: ManagedRunner = { start: async (spec) => {
    const sessionDir = join(store.stateDir, "children", spec.taskId, "sessions")
    const sessionManager = SessionManager.create(project, sessionDir)
    sessionManager.appendMessage({ role: "user", content: "fixture", timestamp: 1000 })
    sessionManager.appendMessage({
      role: "assistant", content: [{ type: "text", text: "TYPED_HANDLE_SESSION_SENTINEL" }],
      api: "openai-completions", provider: "fixture", model: "fixture", stopReason: "stop", timestamp: 1001,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    })
    const path = sessionManager.getSessionFile()
    if (!path) throw new Error("fixture transcript missing")
    transcripts.push({ path, before: JSON.stringify(sessionManager.getEntries().filter((entry) => entry.type === "message")) })
    const handle = adaptInProcessHandle(await runner.resume({ ...spec, sessionDir, agentDir, model: undefined }, path))
    handles.push(handle)
    return handle
  } }
  const manager = createTaskManager({
    store, runners: { "in-process": restoredRunner, process: restoredRunner }, cwd: project,
    config: settings(), planner: () => ({ kind: "resolved", plan: { model: "fixture/model" } }),
  })
  try {
    const response = await buildTaskExecute(makeDeps(manager))("real-session", {
      prompt: "Never replay this prompt", category: "quick", run_in_background: true,
    }, undefined, undefined, { cwd: project, sessionManager: { getSessionId: () => "fixture-parent" } })
    const reportedBeforeRestore = handles.length === 0
    restoreAllowed.resolve()
    await launchSettled(manager, response.details.task_id)
    return {
      response,
      reportedBeforeRestore,
      record: store.load(response.details.task_id),
      sessionText: handles[0]?.lastAssistantText(),
      transcriptMessages: transcripts.map(({ path, before }) => ({
        before,
        after: JSON.stringify(SessionManager.open(path).getEntries().filter((entry) => entry.type === "message")),
        entryTypes: SessionManager.open(path).getEntries().map((entry) => entry.type),
      })),
      isolatedAgentDir: agentDir,
      providerCalls: 0,
    }
  } finally {
    restoreAllowed.resolve()
    for (const record of store.list().records) await launchSettled(manager, record.task_id)
    for (const handle of handles) {
      manager.forget(handle.task_id, { path: "end" })
      await handle.abort()
      await handle.dispose()
    }
  }
}
