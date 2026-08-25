import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import type {
  ManagedChildHandle,
  ManagedRunner,
  ManagedStartSpec,
  RunnerOutcome,
} from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createDagRuntime } from "./dag-runtime"
import { composeTaskEngine } from "./engine"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function deferred<T>() {
  let resolve = (_value: T): void => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

class CapturingRunner implements ManagedRunner {
  readonly starts: Array<{ readonly spec: ManagedStartSpec; readonly settle: () => void }> = []
  readonly #started = deferred<void>()

  start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const outcome = deferred<RunnerOutcome>()
    this.starts.push({
      spec,
      settle: () => outcome.resolve({ status: "completed", finalResponse: "done" }),
    })
    this.#started.resolve()
    return Promise.resolve({
      task_id: spec.taskId,
      sessionId: `child-${spec.taskId}`,
      pid: undefined,
      steer: () => Promise.resolve(),
      followUp: () => Promise.resolve(),
      abort: () => Promise.resolve(),
      subscribe: () => () => undefined,
      waitForOutcome: () => outcome.promise,
      lastAssistantText: () => undefined,
      dispose: () => Promise.resolve(),
    })
  }

  whenStarted(): Promise<void> {
    return this.starts.length > 0 ? Promise.resolve() : this.#started.promise
  }
}

function logger() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined }
}

describe("createDagRuntime skill wiring", () => {
  test("#given a shared task skill loader #when a skilled node starts #then dispatch receives the materialized prompt", async () => {
    const cwd = fs.mkdtempSync(join(tmpdir(), "omo-senpi-dag-shared-skill-"))
    roots.push(cwd)
    const runner = new CapturingRunner()
    const pi = new FakeExtensionAPI()
    const engine = composeTaskEngine({
      pi,
      omoConfig: loadOmoConfig({ cwd }).config,
      cwd,
      sharedParentTools: () => [],
      runnerFactories: { inProcess: () => runner, process: () => runner },
      loadSkills: (names) => ({
        prepend: names.length === 0 ? "" : "<skill name=\"shared\">\nSHARED BODY\n</skill>\n\n",
        resolved: names,
        missing: [],
      }),
    })
    engine.runtime.captureFrom({ sessionManager: { getSessionId: () => "session-shared-skill" } })
    const runtime = createDagRuntime({ pi, engine, logger: logger() })
    await runtime.attach()

    const started = await runtime.manager.start({
      parentSessionId: "session-shared-skill",
      rootSessionId: "session-shared-skill",
      definition: {
        key: "assembled-shared-skill",
        name: "assembled shared skill",
        nodes: [{
          id: "shared",
          prompt: "original prompt",
          load_skills: ["shared"],
          subagent_type: "explore",
          model: "omo-mock/mock-1",
        }],
      },
    })
    await runner.whenStarted()
    const snapshot = runtime.manager.snapshot(started.snapshot.runId, "session-shared-skill")
    const childPrompt = runner.starts[0]?.spec.prompt
    runner.starts[0]?.settle()
    await runtime.wait(started.snapshot.runId, "session-shared-skill")
    runtime.dispose()

    expect(snapshot.diagnostics).not.toContainEqual(expect.objectContaining({ kind: "missing_skill" }))
    expect(childPrompt).toContain("SHARED BODY")
    expect(childPrompt).toContain("original prompt")
  })
})
