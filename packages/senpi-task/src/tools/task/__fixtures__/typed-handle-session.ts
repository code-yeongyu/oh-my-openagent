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
//
// The task tool reports a start that is still admitting once START_REPORT_WINDOW_MS has passed, so it can
// return before this runner has registered its handle. `registerAfterReport` makes that order certain
// instead of a matter of host speed: the runner holds its handle back until the tool has returned.
// Either way the fixture waits for the launch it triggered to settle (launchSettled, bounded by the test's
// own deadline) before it reads from the handle, and again before it tears down: by then the handle exists
// and none of the launch's writes lands after the test's cleanup.
//
// `failAfterReport` fails the fixture right after the tool returned, while that start is still in flight;
// `retired` receives the task id of every child the teardown retires.
export async function realSessionHandle(
  options: {
    readonly registerAfterReport?: boolean
    readonly failAfterReport?: boolean
    readonly retired?: string[]
  } = {},
) {
  const { ModelRuntime, SessionManager, createAgentSession } = await loadSenpiBarrel()
  const project = tempProject()
  const agentDir = join(project, "isolated-agent")
  mkdirSync(agentDir)
  const store = createTaskRecordStore({ project_dir: project })
  const handles: ManagedChildHandle[] = []
  const transcripts: Array<{ path: string; before: string }> = []
  const started: string[] = []
  const reported = Promise.withResolvers<void>()
  let tornDown = false
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
      started.push(spec.taskId)
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
      if (tornDown) {
        // The teardown gave up on this launch (the test's deadline ran out): nothing else will retire this child.
        await retire(handle)
        throw new Error("the fixture was torn down before this start finished")
      }
      handles.push(handle)
      return handle
    },
  }
  const manager = createTaskManager({
    store,
    runners: { "in-process": restoredRunner, process: restoredRunner },
    cwd: project,
    config: settings(),
    planner: () => ({ kind: "resolved", plan: { model: "fixture/model" } }),
  })
  const retire = async (handle: ManagedChildHandle): Promise<void> => {
    manager.forget(handle.task_id, { path: "end" })
    await handle.abort()
    await handle.dispose()
    options.retired?.push(handle.task_id)
  }
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
    if (options.failAfterReport === true) throw new Error("the fixture failed after the task tool reported")
    reported.resolve()
    await launchSettled(manager, response.details.task_id)
    const handle = handles[0]
    if (handle === undefined) throw new Error("the launch settled without a restored child handle")
    return {
      response,
      registeredWhenReported,
      record: store.load(response.details.task_id),
      sessionText: handle.lastAssistantText(),
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
    // A start still in flight finishes first. A wait that runs out of the test's deadline is not an error of
    // its own here: the failure that brought the fixture down is the one to report.
    for (const taskId of started) await launchSettled(manager, taskId).catch(() => undefined)
    tornDown = true
    for (const handle of handles.splice(0)) await retire(handle)
  }
}
