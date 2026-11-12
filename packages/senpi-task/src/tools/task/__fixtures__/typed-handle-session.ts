import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { loadSenpiBarrel } from "../../../lazy/senpi-barrel"

import { createTaskManager } from "../../../manager/manager"
import { settledWithin } from "../../../manager/settled-within"
import { adaptInProcessHandle } from "../../../manager/child-handle"
import type { ManagedChildHandle, ManagedRunner } from "../../../manager"
import { settings, tempProject } from "../../../manager/__fixtures__/manager-fakes"
import { InProcessRunner } from "../../../runners/in-process"
import { createTaskRecordStore } from "../../../store"
import { buildTaskExecute } from "../execute"
import { makeDeps } from "./task-tool-fakes"

// Below bun's 5 s default test timeout, so a runner that never registers fails with the fixture's own message.
const HANDLE_WAIT_MS = 4_000

// Restored real sessions are deterministic: no prompt, provider, or model network call is made.
//
// The task tool reports a start that is still admitting once START_REPORT_WINDOW_MS has passed, so it can
// return before this runner has registered its handle. `registerAfterReport` makes that order certain
// instead of a matter of host speed: the runner holds its handle back until the tool has returned.
// Either way the fixture waits for the start it triggered before it reads from the handle or cleans it up.
export async function realSessionHandle(options: { readonly registerAfterReport?: boolean } = {}) {
  const { ModelRuntime, SessionManager, createAgentSession } = await loadSenpiBarrel()
  const project = tempProject()
  const agentDir = join(project, "isolated-agent")
  mkdirSync(agentDir)
  const store = createTaskRecordStore({ project_dir: project })
  const handles: ManagedChildHandle[] = []
  const transcripts: Array<{ path: string; before: string }> = []
  const reported = Promise.withResolvers<void>()
  const registered = Promise.withResolvers<ManagedChildHandle>()
  // A start that throws is the task tool's to report; the wait below sees the same rejection when it is reached.
  registered.promise.catch(() => undefined)
  const runner = new InProcessRunner({
    createSession: async (options) => {
      const { session } = await createAgentSession({
        ...options,
        modelRuntime: ModelRuntime.createSync({ agentDir, allowModelNetwork: false, refreshOnCreate: false }),
      })
      return session
    },
  })
  const restoredRunner: ManagedRunner = {
    start: async (spec) => {
      const sessionDir = join(store.stateDir, "children", spec.taskId, "sessions")
      const sessionManager = SessionManager.create(project, sessionDir)
      sessionManager.appendMessage({ role: "user", content: "fixture", timestamp: 1000 })
      sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "TYPED_HANDLE_SESSION_SENTINEL" }],
        api: "openai-completions",
        provider: "fixture",
        model: "fixture",
        stopReason: "stop",
        timestamp: 1001,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      })
      const path = sessionManager.getSessionFile()
      if (!path) throw new Error("fixture transcript missing")
      transcripts.push({
        path,
        before: JSON.stringify(sessionManager.getEntries().filter((entry) => entry.type === "message")),
      })
      const handle = adaptInProcessHandle(
        await runner.resume({ ...spec, sessionDir, agentDir, model: undefined }, path),
      )
      if (options.registerAfterReport === true) await reported.promise
      handles.push(handle)
      return handle
    },
  }
  const observedRunner: ManagedRunner = {
    start: (spec) => {
      const starting = restoredRunner.start(spec)
      starting.then(registered.resolve, registered.reject)
      return starting
    },
  }
  const manager = createTaskManager({
    store,
    runners: { "in-process": observedRunner, process: observedRunner },
    cwd: project,
    config: settings(),
    planner: () => ({ kind: "resolved", plan: { model: "fixture/model" } }),
  })
  try {
    const response = await buildTaskExecute(makeDeps(manager))(
      "real-session",
      {
        prompt: "Never replay this prompt",
        category: "quick",
        run_in_background: true,
      },
      undefined,
      undefined,
      { cwd: project, sessionManager: { getSessionId: () => "fixture-parent" } },
    )
    const registeredWhenReported = handles.length > 0
    reported.resolve()
    const waited = await settledWithin(registered.promise, HANDLE_WAIT_MS)
    if (!waited.settled) throw new Error(`the restored runner registered no handle within ${HANDLE_WAIT_MS} ms`)
    return {
      response,
      registeredWhenReported,
      record: store.load(response.details.task_id),
      sessionText: waited.value.lastAssistantText(),
      transcriptMessages: transcripts.map(({ path, before }) => ({
        before,
        after: JSON.stringify(
          SessionManager.open(path)
            .getEntries()
            .filter((entry) => entry.type === "message"),
        ),
        entryTypes: SessionManager.open(path)
          .getEntries()
          .map((entry) => entry.type),
      })),
      isolatedAgentDir: agentDir,
      providerCalls: 0,
    }
  } finally {
    reported.resolve()
    for (const handle of handles) {
      manager.forget(handle.task_id, { path: "end" })
      await handle.abort()
      await handle.dispose()
    }
  }
}
